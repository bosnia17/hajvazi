<?php

declare(strict_types=1);

/*
 * Donacije MZ - povezivanje sa MySQL bazom
 *
 * Podaci za pristup bazi nalaze se u config.php.
 * Nakon uspješnog povezivanja dostupna je PDO varijabla $pdo.
 */


/* =========================================================
   UČITAVANJE KONFIGURACIJE
   ========================================================= */

$configFile = __DIR__ . '/config.php';

if (!is_file($configFile)) {
    databaseErrorResponse(
        'Konfiguracijski fajl config.php nije pronađen.'
    );
}

$config = require $configFile;

if (!is_array($config)) {
    databaseErrorResponse(
        'Konfiguracija baze nije ispravna.'
    );
}


/* =========================================================
   PROVJERA OBAVEZNIH POSTAVKI
   ========================================================= */

$requiredSettings = [
    'dsn',
    'user',
    'password'
];

foreach ($requiredSettings as $setting) {
    if (!array_key_exists($setting, $config)) {
        databaseErrorResponse(
            'U config.php nedostaje postavka: ' . $setting . '.'
        );
    }
}

$dsn = trim((string) $config['dsn']);
$username = (string) $config['user'];
$password = (string) $config['password'];

if ($dsn === '') {
    databaseErrorResponse(
        'DSN postavka baze ne može biti prazna.'
    );
}


/* =========================================================
   PDO POSTAVKE
   ========================================================= */

$pdoOptions = [
    /*
     * PDO baca izuzetak ako SQL upit nije uspješan.
     */
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,

    /*
     * Rezultati se vraćaju kao asocijativni nizovi.
     */
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,

    /*
     * Koriste se stvarni MySQL prepared statements.
     */
    PDO::ATTR_EMULATE_PREPARES => false,

    /*
     * Brojevi iz DECIMAL kolona mogu ostati stringovi,
     * što sprečava nepotrebno gubljenje preciznosti.
     */
    PDO::ATTR_STRINGIFY_FETCHES => false
];


/* =========================================================
   POVEZIVANJE SA BAZOM
   ========================================================= */

try {
    $pdo = new PDO(
        $dsn,
        $username,
        $password,
        $pdoOptions
    );

} catch (PDOException $exception) {

    /*
     * Tehnički detalj zapisuje se samo u serverski log.
     * Korisniku se ne prikazuju lozinka, korisnik ili naziv servera.
     */
    error_log(
        'Donacije MZ connection error: ' .
        $exception->getMessage()
    );

    databaseErrorResponse(
        'Nije moguće uspostaviti vezu sa bazom podataka. ' .
        'Provjerite podatke u config.php i da li je MySQL pokrenut.'
    );
}


/* =========================================================
   POMOĆNA FUNKCIJA ZA GREŠKE POVEZIVANJA
   ========================================================= */

function databaseErrorResponse(string $message): never
{
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
    }

    http_response_code(500);

    echo json_encode(
        ['error' => $message],
        JSON_UNESCAPED_UNICODE |
        JSON_UNESCAPED_SLASHES |
        JSON_INVALID_UTF8_SUBSTITUTE
    );

    exit;
}
