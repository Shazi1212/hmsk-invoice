<?php
// Add a user or change a password. Reads the password from stdin so it never appears in shell history:
//   printf '%s' 'new-password' | php tools/set-password.php <data-dir> <user> [admin|user]
// admin = sees all invoices; user = sees only the invoices they created.
$dir = $argv[1] ?? dirname(__DIR__) . '/data';
$name = strtolower(trim($argv[2] ?? 'admin'));
$role = $argv[3] ?? null;
if (!preg_match('/^[a-z0-9._-]{2,32}$/', $name)) { fwrite(STDERR, "Invalid user name\n"); exit(1); }
$pw = rtrim(stream_get_contents(STDIN), "\r\n");
if (strlen($pw) < 10) { fwrite(STDERR, "Password must be at least 10 characters\n"); exit(1); }
@mkdir($dir, 0700, true);
$file = "$dir/config.json";
$cfg = is_file($file) ? (json_decode(file_get_contents($file), true) ?: []) : [];
if (empty($cfg['users']) && !empty($cfg['password_hash'])) $cfg['users'] = ['admin' => ['hash' => $cfg['password_hash'], 'role' => 'admin']];
unset($cfg['password_hash']);
$old = $cfg['users'][$name] ?? [];
$isFirst = empty($cfg['users']);
$cfg['users'][$name] = ['hash' => password_hash($pw, PASSWORD_DEFAULT), 'role' => $role ?? ($old['role'] ?? ($isFirst ? 'admin' : 'user'))];
file_put_contents($file, json_encode($cfg, JSON_PRETTY_PRINT));
chmod($file, 0600);
echo "Saved user '$name' ({$cfg['users'][$name]['role']}) in $file\n";
