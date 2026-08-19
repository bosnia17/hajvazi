<?php

declare(strict_types=1);

/*
 * Donacije MZ - API
 *
 * Ovaj fajl prima zahtjeve iz app.js i komunicira sa MySQL bazom.
 */

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

date_default_timezone_set('Europe/Sarajevo');

const EUR_TO_BAM = 1.94;

require __DIR__ . '/db.php';


/* =========================================================
   POMOĆNE FUNKCIJE
   ========================================================= */

/**
 * Slanje JSON odgovora i završetak izvršavanja.
 */
function respond(array $data, int $status = 200): never
{
    http_response_code($status);

    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE |
        JSON_UNESCAPED_SLASHES |
        JSON_INVALID_UTF8_SUBSTITUTE
    );

    exit;
}


/**
 * Čitanje JSON podataka poslanih iz JavaScripta.
 */
function requestData(): array
{
    $rawBody = file_get_contents('php://input');

    if ($rawBody === false || trim($rawBody) === '') {
        return $_POST;
    }

    $data = json_decode($rawBody, true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        respond(
            ['error' => 'Poslani podaci nisu ispravan JSON.'],
            400
        );
    }

    if (!is_array($data)) {
        respond(
            ['error' => 'Poslani podaci nisu ispravni.'],
            400
        );
    }

    return $data;
}


/**
 * Provjera obaveznih polja.
 */
function requireFields(array $data, array $fields): void
{
    foreach ($fields as $field => $label) {
        $value = $data[$field] ?? null;

        if ($value === null || trim((string) $value) === '') {
            respond(
                ['error' => 'Obavezno polje: ' . $label . '.'],
                422
            );
        }
    }
}


/**
 * Čišćenje tekstualnog polja.
 */
function textValue(
    array $data,
    string $field,
    int $maximumLength,
    bool $nullable = true
): ?string {
    $value = trim((string) ($data[$field] ?? ''));

    if ($value === '') {
        return $nullable ? null : '';
    }

    if (mb_strlen($value) > $maximumLength) {
        respond(
            [
                'error' =>
                    'Polje "' . $field .
                    '" može sadržavati najviše ' .
                    $maximumLength . ' znakova.'
            ],
            422
        );
    }

    return $value;
}


/**
 * Provjera datuma u formatu YYYY-MM-DD.
 */
function dateValue(
    array $data,
    string $field,
    bool $required = false
): ?string {
    $value = trim((string) ($data[$field] ?? ''));

    if ($value === '') {
        if ($required) {
            respond(
                ['error' => 'Datum nije unesen.'],
                422
            );
        }

        return null;
    }

    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);

    $valid =
        $date !== false &&
        $date->format('Y-m-d') === $value;

    if (!$valid) {
        respond(
            ['error' => 'Datum mora biti u formatu YYYY-MM-DD.'],
            422
        );
    }

    return $value;
}


/**
 * Provjera novčanog iznosa.
 */
function moneyValue(
    array $data,
    string $field,
    bool $required = true
): ?string {
    $rawValue = trim((string) ($data[$field] ?? ''));

    if ($rawValue === '') {
        if ($required) {
            respond(
                ['error' => 'Iznos nije unesen.'],
                422
            );
        }

        return null;
    }

    $normalized = str_replace(',', '.', $rawValue);

    if (!is_numeric($normalized)) {
        respond(
            ['error' => 'Iznos mora biti broj.'],
            422
        );
    }

    $amount = (float) $normalized;

    if ($amount < 0 || ($required && $amount <= 0)) {
        respond(
            [
                'error' => $required
                    ? 'Iznos mora biti veći od nule.'
                    : 'Iznos ne može biti negativan.'
            ],
            422
        );
    }

    if ($amount > 9999999999.99) {
        respond(
            ['error' => 'Uneseni iznos je prevelik.'],
            422
        );
    }

    return number_format($amount, 2, '.', '');
}


/**
 * Provjera ID-a projekta.
 */
function projectId(mixed $value): int
{
    $id = filter_var(
        $value,
        FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1]]
    );

    if ($id === false) {
        respond(
            ['error' => 'ID projekta nije ispravan.'],
            422
        );
    }

    return (int) $id;
}


/**
 * Provjera da projekat postoji.
 */
function ensureProjectExists(PDO $pdo, int $id): void
{
    $statement = $pdo->prepare(
        'SELECT id FROM projekti WHERE id = ? LIMIT 1'
    );

    $statement->execute([$id]);

    if (!$statement->fetchColumn()) {
        respond(
            ['error' => 'Projekat nije pronađen.'],
            404
        );
    }
}


/* =========================================================
   USMJERAVANJE ZAHTJEVA
   ========================================================= */

$action = trim((string) ($_GET['action'] ?? 'dashboard'));
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');


try {

    /* =====================================================
       DASHBOARD: PROJEKTI I UKUPNA STATISTIKA
       GET api.php?action=dashboard
       ===================================================== */

    if ($action === 'dashboard' && $method === 'GET') {

        $projectsStatement = $pdo->query(
            "
            SELECT
                p.id,
                p.naziv,
                p.opis,
                p.datum_pocetka,
                p.datum_zavrsetka,
                p.cilj,
                p.valuta,
                p.status,
                p.odgovorna_osoba,
                p.kontakt,
                p.created_at,
                COALESCE(d.prihodi_bam, 0) AS prihodi_bam,
                COALESCE(d.prihodi_eur, 0) AS prihodi_eur,
                COALESCE(r.rashodi_bam, 0) AS rashodi_bam,
                COALESCE(r.rashodi_eur, 0) AS rashodi_eur,
                COALESCE(d.prihodi_bam, 0) +
                    COALESCE(d.prihodi_eur, 0) * 1.94 AS prihodi_km,
                COALESCE(r.rashodi_bam, 0) +
                    COALESCE(r.rashodi_eur, 0) * 1.94 AS rashodi_km,
                (
                    COALESCE(d.prihodi_bam, 0) +
                    COALESCE(d.prihodi_eur, 0) * 1.94
                ) - (
                    COALESCE(r.rashodi_bam, 0) +
                    COALESCE(r.rashodi_eur, 0) * 1.94
                ) AS saldo_km
            FROM projekti AS p
            LEFT JOIN (
                SELECT
                    projekat_id,
                    SUM(CASE WHEN valuta='BAM' THEN iznos ELSE 0 END)
                        AS prihodi_bam,
                    SUM(CASE WHEN valuta='EUR' THEN iznos ELSE 0 END)
                        AS prihodi_eur
                FROM donacije
                GROUP BY projekat_id
            ) AS d
                ON d.projekat_id = p.id
            LEFT JOIN (
                SELECT
                    projekat_id,
                    SUM(CASE WHEN valuta='BAM' THEN iznos ELSE 0 END)
                        AS rashodi_bam,
                    SUM(CASE WHEN valuta='EUR' THEN iznos ELSE 0 END)
                        AS rashodi_eur
                FROM rashodi
                GROUP BY projekat_id
            ) AS r
                ON r.projekat_id = p.id
            ORDER BY
                CASE p.status
                    WHEN 'aktivan' THEN 1
                    WHEN 'planiran' THEN 2
                    WHEN 'zavrsen' THEN 3
                    ELSE 4
                END,
                p.datum_pocetka DESC,
                p.id DESC
            "
        );

        $projects = $projectsStatement->fetchAll();

        $totalsStatement = $pdo->query(
            "
            SELECT
                (SELECT COALESCE(SUM(CASE WHEN valuta='BAM' THEN iznos ELSE 0 END),0)
                    FROM donacije) AS prihodi_bam,
                (SELECT COALESCE(SUM(CASE WHEN valuta='EUR' THEN iznos ELSE 0 END),0)
                    FROM donacije) AS prihodi_eur,
                (SELECT COALESCE(SUM(CASE WHEN valuta='BAM' THEN iznos ELSE 0 END),0)
                    FROM rashodi) AS rashodi_bam,
                (SELECT COALESCE(SUM(CASE WHEN valuta='EUR' THEN iznos ELSE 0 END),0)
                    FROM rashodi) AS rashodi_eur
            "
        );

        $row = $totalsStatement->fetch() ?: [];
        $incomeBam = (float) ($row['prihodi_bam'] ?? 0);
        $incomeEur = (float) ($row['prihodi_eur'] ?? 0);
        $expensesBam = (float) ($row['rashodi_bam'] ?? 0);
        $expensesEur = (float) ($row['rashodi_eur'] ?? 0);

        $totals = [
            'kurs_eur_km' => EUR_TO_BAM,
            'prihodi' => [
                'BAM' => $incomeBam,
                'EUR' => $incomeEur,
                'ukupno_km' => $incomeBam + $incomeEur * EUR_TO_BAM
            ],
            'rashodi' => [
                'BAM' => $expensesBam,
                'EUR' => $expensesEur,
                'ukupno_km' => $expensesBam + $expensesEur * EUR_TO_BAM
            ],
            'saldo' => [
                'BAM' => $incomeBam - $expensesBam,
                'EUR' => $incomeEur - $expensesEur,
                'ukupno_km' =>
                    ($incomeBam + $incomeEur * EUR_TO_BAM) -
                    ($expensesBam + $expensesEur * EUR_TO_BAM)
            ]
        ];

        respond([
            'projekti' => $projects,
            'ukupno' => $totals
        ]);
    }


    /* =====================================================
       DETALJNI PREGLED PROJEKTA
       GET api.php?action=projekat&id=1
       ===================================================== */

    if ($action === 'projekat' && $method === 'GET') {

        $id = projectId($_GET['id'] ?? null);

        $projectStatement = $pdo->prepare(
            "
            SELECT
                id,
                naziv,
                opis,
                datum_pocetka,
                datum_zavrsetka,
                cilj,
                valuta,
                status,
                odgovorna_osoba,
                kontakt,
                created_at
            FROM projekti
            WHERE id = ?
            LIMIT 1
            "
        );

        $projectStatement->execute([$id]);
        $project = $projectStatement->fetch();

        if (!$project) {
            respond(
                ['error' => 'Projekat nije pronađen.'],
                404
            );
        }

        $donationsStatement = $pdo->prepare(
            "
            SELECT
                id,
                projekat_id,
                donator,
                kontakt,
                iznos,
                valuta,
                datum,
                nacin,
                napomena,
                created_at
            FROM donacije
            WHERE projekat_id = ?
            ORDER BY datum DESC, id DESC
            "
        );

        $donationsStatement->execute([$id]);

        $expensesStatement = $pdo->prepare(
            "
            SELECT
                id,
                projekat_id,
                opis,
                iznos,
                valuta,
                datum,
                dobavljac,
                broj_racuna,
                created_at
            FROM rashodi
            WHERE projekat_id = ?
            ORDER BY datum DESC, id DESC
            "
        );

        $expensesStatement->execute([$id]);

        respond([
            'projekat' => $project,
            'donacije' => $donationsStatement->fetchAll(),
            'rashodi' => $expensesStatement->fetchAll()
        ]);
    }


    /* =====================================================
       DODAVANJE NOVOG PROJEKTA
       POST api.php?action=projekti
       ===================================================== */

    if ($action === 'projekti' && $method === 'POST') {

        $data = requestData();

        requireFields($data, [
            'naziv' => 'Naziv projekta',
            'datum_pocetka' => 'Datum početka',
            'odgovorna_osoba' => 'Odgovorna osoba',
            'kontakt' => 'Kontakt broj'
        ]);

        $name = textValue($data, 'naziv', 180, false);
        $description = textValue($data, 'opis', 5000);
        $startDate = dateValue($data, 'datum_pocetka', true);
        $endDate = dateValue($data, 'datum_zavrsetka');
        $goal = moneyValue($data, 'cilj', false);
        $currency = strtoupper(
            trim((string) ($data['valuta'] ?? 'BAM'))
        );
        $responsiblePerson = textValue(
            $data,
            'odgovorna_osoba',
            150,
            false
        );
        $contact = textValue($data, 'kontakt', 80, false);

        $status = trim(
            (string) ($data['status'] ?? 'planiran')
        );

        $allowedStatuses = [
            'planiran',
            'aktivan',
            'zavrsen',
            'obustavljen'
        ];

        if (!in_array($currency, ['BAM', 'EUR'], true)) {
            respond(
                ['error' => 'Valuta projekta nije ispravna.'],
                422
            );
        }

        if (!in_array($status, $allowedStatuses, true)) {
            respond(
                ['error' => 'Status projekta nije ispravan.'],
                422
            );
        }

        if (
            $endDate !== null &&
            $startDate !== null &&
            $endDate < $startDate
        ) {
            respond(
                [
                    'error' =>
                        'Datum završetka ne može biti prije datuma početka.'
                ],
                422
            );
        }

        $insertStatement = $pdo->prepare(
            "
            INSERT INTO projekti (
                naziv,
                opis,
                datum_pocetka,
                datum_zavrsetka,
                cilj,
                valuta,
                status,
                odgovorna_osoba,
                kontakt
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "
        );

        $insertStatement->execute([
            $name,
            $description,
            $startDate,
            $endDate,
            $goal,
            $currency,
            $status,
            $responsiblePerson,
            $contact
        ]);

        respond(
            [
                'ok' => true,
                'message' => 'Projekat je uspješno sačuvan.',
                'id' => (int) $pdo->lastInsertId()
            ],
            201
        );
    }


    /* =====================================================
       DODAVANJE DONACIJE
       POST api.php?action=donacije
       ===================================================== */

    if ($action === 'donacije' && $method === 'POST') {

        $data = requestData();

        requireFields($data, [
            'projekat_id' => 'Projekat',
            'donator' => 'Donator',
            'iznos' => 'Iznos',
            'datum' => 'Datum'
        ]);

        $id = projectId($data['projekat_id']);
        ensureProjectExists($pdo, $id);

        $donor = textValue($data, 'donator', 180, false);
        $contact = textValue($data, 'kontakt', 80);
        $amount = moneyValue($data, 'iznos');
        $currency = strtoupper(trim((string) ($data['valuta'] ?? 'BAM')));
        $date = dateValue($data, 'datum', true);
        $note = textValue($data, 'napomena', 255);

        $paymentMethod = trim(
            (string) ($data['nacin'] ?? 'gotovina')
        );

        $allowedPaymentMethods = [
            'gotovina',
            'racun',
            'roba_usluga'
        ];

        if (
            !in_array(
                $paymentMethod,
                $allowedPaymentMethods,
                true
            )
        ) {
            respond(
                ['error' => 'Način donacije nije ispravan.'],
                422
            );
        }

        if (!in_array($currency, ['BAM', 'EUR'], true)) {
            respond(['error' => 'Valuta donacije nije ispravna.'], 422);
        }

        $insertStatement = $pdo->prepare(
            "
            INSERT INTO donacije (
                projekat_id,
                donator,
                kontakt,
                iznos,
                valuta,
                datum,
                nacin,
                napomena
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "
        );

        $insertStatement->execute([
            $id,
            $donor,
            $contact,
            $amount,
            $currency,
            $date,
            $paymentMethod,
            $note
        ]);

        respond(
            [
                'ok' => true,
                'message' => 'Prihod je uspješno evidentiran.',
                'id' => (int) $pdo->lastInsertId()
            ],
            201
        );
    }


    /* =====================================================
       DODAVANJE RASHODA
       POST api.php?action=rashodi
       ===================================================== */

    if ($action === 'rashodi' && $method === 'POST') {

        $data = requestData();

        requireFields($data, [
            'projekat_id' => 'Projekat',
            'opis' => 'Opis rashoda',
            'iznos' => 'Iznos',
            'datum' => 'Datum'
        ]);

        $id = projectId($data['projekat_id']);
        ensureProjectExists($pdo, $id);

        $description = textValue($data, 'opis', 255, false);
        $amount = moneyValue($data, 'iznos');
        $currency = strtoupper(trim((string) ($data['valuta'] ?? 'BAM')));
        $date = dateValue($data, 'datum', true);
        $supplier = textValue($data, 'dobavljac', 180);
        $receiptNumber = textValue(
            $data,
            'broj_racuna',
            100
        );

        if (!in_array($currency, ['BAM', 'EUR'], true)) {
            respond(['error' => 'Valuta rashoda nije ispravna.'], 422);
        }

        $insertStatement = $pdo->prepare(
            "
            INSERT INTO rashodi (
                projekat_id,
                opis,
                iznos,
                valuta,
                datum,
                dobavljac,
                broj_racuna
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            "
        );

        $insertStatement->execute([
            $id,
            $description,
            $amount,
            $currency,
            $date,
            $supplier,
            $receiptNumber
        ]);

        respond(
            [
                'ok' => true,
                'message' => 'Rashod je uspješno evidentiran.',
                'id' => (int) $pdo->lastInsertId()
            ],
            201
        );
    }


    /* =====================================================
       IZMJENA PROJEKTA
       PUT api.php?action=projekti&id=1
       ===================================================== */

    if ($action === 'projekti' && $method === 'PUT') {
        $data = requestData();
        $id = projectId($_GET['id'] ?? ($data['id'] ?? null));
        ensureProjectExists($pdo, $id);

        requireFields($data, [
            'naziv' => 'Naziv projekta',
            'datum_pocetka' => 'Datum početka',
            'odgovorna_osoba' => 'Odgovorna osoba',
            'kontakt' => 'Kontakt broj'
        ]);

        $name = textValue($data, 'naziv', 180, false);
        $description = textValue($data, 'opis', 5000);
        $startDate = dateValue($data, 'datum_pocetka', true);
        $endDate = dateValue($data, 'datum_zavrsetka');
        $goal = moneyValue($data, 'cilj', false);
        $currency = strtoupper(trim((string) ($data['valuta'] ?? 'BAM')));
        $status = trim((string) ($data['status'] ?? 'planiran'));
        $responsiblePerson = textValue($data, 'odgovorna_osoba', 150, false);
        $contact = textValue($data, 'kontakt', 80, false);

        if (!in_array($currency, ['BAM', 'EUR'], true)) {
            respond(['error' => 'Valuta projekta nije ispravna.'], 422);
        }

        if (!in_array($status, ['planiran', 'aktivan', 'zavrsen', 'obustavljen'], true)) {
            respond(['error' => 'Status projekta nije ispravan.'], 422);
        }

        if ($endDate !== null && $endDate < $startDate) {
            respond(['error' => 'Datum završetka ne može biti prije datuma početka.'], 422);
        }

        $statement = $pdo->prepare(
            'UPDATE projekti SET naziv=?, opis=?, datum_pocetka=?, datum_zavrsetka=?,
             cilj=?, valuta=?, status=?, odgovorna_osoba=?, kontakt=? WHERE id=?'
        );
        $statement->execute([
            $name, $description, $startDate, $endDate, $goal, $currency,
            $status, $responsiblePerson, $contact, $id
        ]);

        respond(['ok' => true, 'message' => 'Projekat je uspješno izmijenjen.']);
    }


    /* =====================================================
       BRISANJE PROJEKTA
       DELETE api.php?action=projekti&id=1
       ===================================================== */

    if ($action === 'projekti' && $method === 'DELETE') {
        $id = projectId($_GET['id'] ?? null);
        ensureProjectExists($pdo, $id);

        $statement = $pdo->prepare('DELETE FROM projekti WHERE id=?');
        $statement->execute([$id]);

        respond([
            'ok' => true,
            'message' => 'Projekat i povezani finansijski zapisi su obrisani.'
        ]);
    }


    /* =====================================================
       IZMJENA I BRISANJE DONACIJE
       ===================================================== */

    if ($action === 'donacije' && $method === 'PUT') {
        $data = requestData();
        $id = projectId($_GET['id'] ?? ($data['id'] ?? null));

        requireFields($data, [
            'donator' => 'Donator',
            'iznos' => 'Iznos',
            'datum' => 'Datum'
        ]);

        $statement = $pdo->prepare('SELECT id FROM donacije WHERE id=?');
        $statement->execute([$id]);
        if (!$statement->fetchColumn()) {
            respond(['error' => 'Prihod nije pronađen.'], 404);
        }

        $donor = textValue($data, 'donator', 180, false);
        $contact = textValue($data, 'kontakt', 80);
        $amount = moneyValue($data, 'iznos');
        $currency = strtoupper(trim((string) ($data['valuta'] ?? 'BAM')));
        $date = dateValue($data, 'datum', true);
        $paymentMethod = trim((string) ($data['nacin'] ?? 'gotovina'));
        $note = textValue($data, 'napomena', 255);

        if (!in_array($paymentMethod, ['gotovina', 'racun', 'roba_usluga'], true)) {
            respond(['error' => 'Način prihoda nije ispravan.'], 422);
        }

        if (!in_array($currency, ['BAM', 'EUR'], true)) {
            respond(['error' => 'Valuta prihoda nije ispravna.'], 422);
        }

        $statement = $pdo->prepare(
            'UPDATE donacije SET donator=?, kontakt=?, iznos=?, valuta=?,
             datum=?, nacin=?, napomena=? WHERE id=?'
        );
        $statement->execute([
            $donor, $contact, $amount, $currency, $date,
            $paymentMethod, $note, $id
        ]);

        respond(['ok' => true, 'message' => 'Prihod je uspješno izmijenjen.']);
    }

    if ($action === 'donacije' && $method === 'DELETE') {
        $id = projectId($_GET['id'] ?? null);
        $statement = $pdo->prepare('DELETE FROM donacije WHERE id=?');
        $statement->execute([$id]);

        if ($statement->rowCount() === 0) {
            respond(['error' => 'Prihod nije pronađen.'], 404);
        }

        respond(['ok' => true, 'message' => 'Prihod je obrisan.']);
    }


    /* =====================================================
       IZMJENA I BRISANJE RASHODA
       ===================================================== */

    if ($action === 'rashodi' && $method === 'PUT') {
        $data = requestData();
        $id = projectId($_GET['id'] ?? ($data['id'] ?? null));

        requireFields($data, [
            'opis' => 'Opis rashoda',
            'iznos' => 'Iznos',
            'datum' => 'Datum'
        ]);

        $statement = $pdo->prepare('SELECT id FROM rashodi WHERE id=?');
        $statement->execute([$id]);
        if (!$statement->fetchColumn()) {
            respond(['error' => 'Rashod nije pronađen.'], 404);
        }

        $description = textValue($data, 'opis', 255, false);
        $amount = moneyValue($data, 'iznos');
        $currency = strtoupper(trim((string) ($data['valuta'] ?? 'BAM')));
        $date = dateValue($data, 'datum', true);
        $supplier = textValue($data, 'dobavljac', 180);
        $receiptNumber = textValue($data, 'broj_racuna', 100);

        if (!in_array($currency, ['BAM', 'EUR'], true)) {
            respond(['error' => 'Valuta rashoda nije ispravna.'], 422);
        }

        $statement = $pdo->prepare(
            'UPDATE rashodi SET opis=?, iznos=?, valuta=?, datum=?,
             dobavljac=?, broj_racuna=? WHERE id=?'
        );
        $statement->execute([
            $description, $amount, $currency, $date,
            $supplier, $receiptNumber, $id
        ]);

        respond(['ok' => true, 'message' => 'Rashod je uspješno izmijenjen.']);
    }

    if ($action === 'rashodi' && $method === 'DELETE') {
        $id = projectId($_GET['id'] ?? null);
        $statement = $pdo->prepare('DELETE FROM rashodi WHERE id=?');
        $statement->execute([$id]);

        if ($statement->rowCount() === 0) {
            respond(['error' => 'Rashod nije pronađen.'], 404);
        }

        respond(['ok' => true, 'message' => 'Rashod je obrisan.']);
    }


    /* =====================================================
       AKCIJA ILI HTTP METODA NIJE PODRŽANA
       ===================================================== */

    if (
        in_array(
            $action,
            ['dashboard', 'projekat', 'projekti', 'donacije', 'rashodi'],
            true
        )
    ) {
        respond(
            ['error' => 'HTTP metoda nije dozvoljena za ovu akciju.'],
            405
        );
    }

    respond(
        ['error' => 'Tražena API akcija ne postoji.'],
        404
    );


} catch (PDOException $exception) {

    /*
     * Detalj greške se zapisuje u serverski log,
     * ali se korisniku ne prikazuju osjetljivi podaci baze.
     */
    error_log(
        'Donacije MZ database error: ' .
        $exception->getMessage()
    );

    respond(
        [
            'error' =>
                'Došlo je do greške prilikom rada sa bazom podataka.'
        ],
        500
    );

} catch (Throwable $exception) {

    error_log(
        'Donacije MZ application error: ' .
        $exception->getMessage()
    );

    respond(
        ['error' => 'Došlo je do neočekivane greške.'],
        500
    );
}
