# Invoice – server mode (PHP + Apache). Data lives in the /data volume, outside the web root.
FROM php:8.3-apache

RUN a2enmod headers \
 && mkdir -p /data /app/tools \
 && chown www-data:www-data /data && chmod 700 /data

COPY docker/apache-invoice.conf /etc/apache2/conf-available/invoice.conf
RUN a2enconf invoice

COPY public/ /var/www/html/
COPY tools/set-password.php /app/tools/set-password.php
COPY docker/entrypoint.sh /usr/local/bin/invoice-entrypoint
RUN chmod +x /usr/local/bin/invoice-entrypoint && rm -f /var/www/html/config.php

ENV INVOICE_DATA_DIR=/data
VOLUME /data
EXPOSE 80
ENTRYPOINT ["invoice-entrypoint"]
CMD ["apache2-foreground"]
