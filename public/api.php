<?php
// Invoice API (server mode): user login + one JSON database kept outside the web root.
//   data/config.json  {"users": {"admin": {"hash": "...", "role": "admin"}, "jane": {...,"role": "user"}}}
//   data/db.json      parties, catalogue items, invoices, per-user settings
//   data/backups/     last 50 versions of db.json
// Visibility is enforced here: a "user" only receives and may change the invoices
// they created; an "admin" sees everything. Parties marked adminOnly are admin-only.
declare(strict_types=1);

// The data folder must live outside the web root. Set INVOICE_DATA_DIR, or create config.php next to
// this file with  <?php $DATA = '/path/to/data';  (default: ../data relative to public/).
if (is_file(__DIR__ . '/config.php')) require __DIR__ . '/config.php';
$DATA = $DATA ?? (getenv('INVOICE_DATA_DIR') ?: dirname(__DIR__) . '/data');
if (!is_dir($DATA)) @mkdir($DATA, 0700, true);
$DB = "$DATA/db.json";
$CONFIG = "$DATA/config.json";

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

session_set_cookie_params([
    'lifetime' => 60 * 60 * 24 * 30,
    'path' => '/',
    'secure' => !empty($_SERVER['HTTPS']) || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https',
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_name('invoice_session');
session_start();

function out(int $code, array $body): never {
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function read_json(string $file, $fallback) {
    if (!is_file($file)) return $fallback;
    $j = json_decode((string)file_get_contents($file), true);
    return is_array($j) ? $j : $fallback;
}

function users(string $config): array {
    $cfg = read_json($config, []);
    if (empty($cfg['users']) && !empty($cfg['password_hash'])) {   // single-password config from v1
        $cfg['users'] = ['admin' => ['hash' => $cfg['password_hash'], 'role' => 'admin']];
    }
    return $cfg['users'] ?? [];
}

function empty_db(): array {
    return ['rev' => 0, 'parties' => [], 'items' => [], 'invoices' => [], 'userSettings' => []];
}

// ---- visibility rules
function can_see_invoice(array $i, string $user, bool $admin): bool {
    return $admin || ($i['createdBy'] ?? '') === $user;
}
function can_see_party(array $p, bool $admin): bool {
    return $admin || empty($p['adminOnly']);
}

function visible_db(array $db, string $user, bool $admin): array {
    return [
        'rev' => $db['rev'] ?? 0,
        'parties' => array_values(array_filter($db['parties'] ?? [], fn($p) => can_see_party($p, $admin))),
        'items' => $db['items'] ?? [],
        'invoices' => array_values(array_filter($db['invoices'] ?? [], fn($i) => can_see_invoice($i, $user, $admin))),
        'settings' => (object)($db['userSettings'][$user] ?? []),
    ];
}

// Write under an exclusive lock, keep a backup of the previous version.
function write_db(string $DATA, string $DB, callable $change) {
    $fp = fopen("$DATA/.lock", 'c');
    flock($fp, LOCK_EX);
    $db = read_json($DB, empty_db());
    $result = $change($db);
    $db['rev'] = (int)($db['rev'] ?? 0) + 1;
    $db['savedAt'] = date('c');
    if (is_file($DB)) {
        @mkdir("$DATA/backups", 0700, true);
        copy($DB, "$DATA/backups/db-" . date('Ymd-His') . "-r" . ($db['rev'] - 1) . ".json");
        $old = glob("$DATA/backups/db-*.json");
        sort($old);
        foreach (array_slice($old, 0, max(0, count($old) - 50)) as $f) unlink($f);
    }
    file_put_contents("$DB.tmp", json_encode($db, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
    chmod("$DB.tmp", 0600);
    rename("$DB.tmp", $DB);
    flock($fp, LOCK_UN);
    return [$db, $result];
}

function newer(?array $old, array $new): bool {
    return !$old || strcmp((string)($new['updatedAt'] ?? ''), (string)($old['updatedAt'] ?? '')) >= 0;
}

// ---- numbering (server-side so two users never get the same number)
const SERIES_PREFIX = ['proforma' => 'PF', 'quote' => 'AN', 'credit_note' => 'RK', 'self_billing' => 'GS'];
function format_number(string $fmt, int $n, string $date): string {
    [$y, $m] = explode('-', $date . '-01');
    $s = str_replace(['{YYYY}', '{YY}', '{MM}'], [$y, substr($y, 2), $m], $fmt);
    return preg_replace_callback('/\{(N+)\}/', fn($x) => str_pad((string)$n, strlen($x[1]), '0', STR_PAD_LEFT), $s);
}
function numbering_party_id(array $inv): string {
    return ($inv['docType'] ?? '') === 'self_billing' ? ($inv['recipientId'] ?? '') : ($inv['senderId'] ?? '');
}

$action = $_GET['a'] ?? '';
// Lets the browser app decide between server mode (users exist) and browser-only mode.
if ($action === 'status') out(200, ['app' => 'invoice', 'server' => count(users($CONFIG)) > 0]);
// Simple CSRF guard: browsers can't send this header cross-site without a preflight.
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_SERVER['HTTP_X_INVOICE_APP'] ?? '') !== '1') out(403, ['error' => 'bad request']);
$input = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];

if ($action === 'login') {
    $users = users($CONFIG);
    if (!$users) out(500, ['error' => 'No users set. Run tools/set-password.php on the server.']);
    // throttle: 8 failed attempts per 15 minutes per IP
    $ip = $_SERVER['REMOTE_ADDR'] ?? '?';
    $tf = "$DATA/throttle.json";
    $now = time();
    $t = array_filter(read_json($tf, []), fn($v) => $v['until'] > $now);
    if (($t[$ip]['n'] ?? 0) >= 8) out(429, ['error' => 'Too many attempts. Try again in 15 minutes.']);
    $name = strtolower(trim((string)($input['user'] ?? '')));
    $u = $users[$name] ?? null;
    if (!$u || !password_verify((string)($input['password'] ?? ''), $u['hash'])) {
        $t[$ip] = ['n' => ($t[$ip]['n'] ?? 0) + 1, 'until' => $now + 900];
        file_put_contents($tf, json_encode($t));
        usleep(400000);
        out(401, ['error' => 'Wrong user name or password']);
    }
    unset($t[$ip]);
    file_put_contents($tf, json_encode($t));
    session_regenerate_id(true);
    $_SESSION['user'] = $name;
    $_SESSION['role'] = $u['role'] ?? 'user';
    out(200, ['user' => $name, 'role' => $_SESSION['role']]);
}

if ($action === 'logout') {
    $_SESSION = [];
    session_destroy();
    out(200, ['ok' => true]);
}

$user = $_SESSION['user'] ?? '';
if (!$user || !isset(users($CONFIG)[$user])) out(401, ['error' => 'login required']);
$admin = ($_SESSION['role'] ?? '') === 'admin';

if ($action === 'me') out(200, ['user' => $user, 'role' => $_SESSION['role']]);

if ($action === 'load') out(200, visible_db(read_json($DB, empty_db()), $user, $admin));

// Merge the client's changes into the server copy, record by record.
if ($action === 'save') {
    $in = $input['db'] ?? null;
    if (!is_array($in) || !isset($in['parties'], $in['invoices'])) out(400, ['error' => 'invalid data']);
    $del = $input['deleted'] ?? [];
    $replace = !empty($input['replace']);
    if ($replace && !$admin) out(403, ['error' => 'Only the admin can restore a backup']);

    [$db] = write_db($DATA, $DB, function (&$db) use ($in, $del, $replace, $user, $admin) {
        if ($replace) {
            $db = ['rev' => $db['rev'] ?? 0, 'parties' => $in['parties'], 'items' => $in['items'] ?? [],
                   'invoices' => $in['invoices'], 'userSettings' => $db['userSettings'] ?? []];
            return;
        }
        // invoices
        $inv = [];
        foreach ($db['invoices'] ?? [] as $i) $inv[$i['id']] = $i;
        foreach ($in['invoices'] as $i) {
            if (empty($i['id'])) continue;
            $old = $inv[$i['id']] ?? null;
            if ($old && !can_see_invoice($old, $user, $admin)) continue;
            if (!newer($old, $i)) continue;
            $i['createdBy'] = $old['createdBy'] ?? ($admin ? ($i['createdBy'] ?? $user) : $user);
            $inv[$i['id']] = $i;
        }
        foreach ($del['invoices'] ?? [] as $id) {
            $old = $inv[$id] ?? null;
            if ($old && can_see_invoice($old, $user, $admin) && ($old['status'] ?? '') === 'draft') unset($inv[$id]);
        }
        $db['invoices'] = array_values($inv);

        // parties (counters only ever move forward)
        $par = [];
        foreach ($db['parties'] ?? [] as $p) $par[$p['id']] = $p;
        foreach ($in['parties'] as $p) {
            if (empty($p['id'])) continue;
            $old = $par[$p['id']] ?? null;
            if ($old && !can_see_party($old, $admin)) continue;
            if (!newer($old, $p)) continue;
            if (!$admin) $p['adminOnly'] = false;
            // counters only move forward, unless someone set them by hand in the dialog
            $manual = strcmp((string)($p['countersSetAt'] ?? ''), (string)($old['countersSetAt'] ?? '')) > 0;
            foreach ($manual ? [] : ($old['counters'] ?? []) as $series => $c) {
                $nc = $p['counters'][$series] ?? null;
                if (!$nc || ($nc['year'] ?? '') < ($c['year'] ?? '') || (($nc['year'] ?? '') === ($c['year'] ?? '') && (int)$nc['next'] < (int)$c['next'])) {
                    $p['counters'][$series] = $c;
                }
            }
            $par[$p['id']] = $p;
        }
        foreach ($del['parties'] ?? [] as $id) {
            if (isset($par[$id]) && can_see_party($par[$id], $admin)) unset($par[$id]);
        }
        $db['parties'] = array_values($par);

        // catalogue
        $it = [];
        foreach ($db['items'] ?? [] as $x) $it[$x['id']] = $x;
        foreach ($in['items'] ?? [] as $x) if (!empty($x['id']) && newer($it[$x['id']] ?? null, $x)) $it[$x['id']] = $x;
        foreach ($del['items'] ?? [] as $id) unset($it[$id]);
        $db['items'] = array_values($it);

        $db['userSettings'][$user] = (array)($in['settings'] ?? []);
        unset($db['settings']);
    });
    out(200, visible_db($db, $user, $admin));
}

// Reserve an invoice number for the issuer (sender, or the customer for self-billing).
// Monthly clients (billing = monthly + clientCode) have their own series on the client record:
// "{CODE} {YYYY}/{MM}-{NN}" with year/month of the service period.
// With "number": check that this manual number is still free.
if ($action === 'number') {
    $partyId = (string)($input['partyId'] ?? '');
    $clientId = (string)($input['clientId'] ?? '');
    $series = (string)($input['series'] ?? 'invoice');
    $isDate = fn($d) => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$d);
    $date = $isDate($input['date'] ?? '') ? $input['date'] : date('Y-m-d');
    $periodDate = $isDate($input['periodDate'] ?? '') ? $input['periodDate'] : $date;
    $manual = trim((string)($input['number'] ?? ''));
    $invId = (string)($input['invoiceId'] ?? '');

    [, $res] = write_db($DATA, $DB, function (&$db) use ($partyId, $clientId, $series, $date, $periodDate, $manual, $invId, $admin) {
        $pi = $ci = null;
        foreach ($db['parties'] as $k => $p) {
            if ($p['id'] === $partyId) $pi = $k;
            if ($p['id'] === $clientId) $ci = $k;
        }
        if ($pi === null || !can_see_party($db['parties'][$pi], $admin)) return ['error' => 'Unknown sender'];
        $client = $ci !== null && can_see_party($db['parties'][$ci], $admin) ? $db['parties'][$ci] : null;
        $monthly = $series === 'invoice' && $client && ($client['billing'] ?? '') === 'monthly' && !empty($client['clientCode']);
        $used = [];
        foreach ($db['invoices'] as $i) {
            if (($i['status'] ?? 'draft') !== 'draft' && $i['id'] !== $invId && numbering_party_id($i) === $partyId) $used[$i['number']] = true;
        }
        if ($manual !== '') return isset($used[$manual]) ? ['error' => "Number $manual is already used for this sender."] : ['number' => $manual];
        if ($monthly) {
            $p = &$db['parties'][$ci];       // the counter lives on the client
            $series = 'client';
            $date = $periodDate;
            $fmt = str_replace('{CODE}', $client['clientCode'], ($client['clientNumberFormat'] ?? '') ?: '{CODE} {YYYY}/{MM}-{NN}');
        } else {
            $p = &$db['parties'][$pi];
            $fmt = $series === 'invoice' ? ($p['numberFormat'] ?? '') : (SERIES_PREFIX[$series] ?? 'DOC') . '-{YYYY}-{NNN}';
            if ($fmt === '') $fmt = 'RE-{YYYY}-{NNN}';
        }
        $year = substr($date, 0, 4);
        $c = $p['counters'][$series] ?? ['next' => 1, 'year' => $year];
        $n = (($p['resetYearly'] ?? '1') !== '0' && ($c['year'] ?? $year) !== $year) ? 1 : max(1, (int)($c['next'] ?? 1));
        $num = format_number($fmt, $n, $date);
        while (isset($used[$num]) && $n < 99999) $num = format_number($fmt, ++$n, $date);
        $p['counters'][$series] = ['next' => $n + 1, 'year' => $year];
        $p['updatedAt'] = gmdate('Y-m-d\TH:i:s.v\Z');
        return ['number' => $num, 'counters' => $p['counters'], 'ownerId' => $p['id']];
    });
    if (isset($res['error'])) out(409, $res);
    out(200, $res);
}

out(404, ['error' => 'unknown action']);
