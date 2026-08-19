<?php

declare(strict_types=1);

/*
 * Donacije MZ - postavke MySQL baze
 *
 * Naziv baze: hajvazi
 *
 * Ove postavke odgovaraju uobičajenoj lokalnoj XAMPP instalaciji:
 * - MySQL server: localhost
 * - korisnik: root
 * - lozinka: prazna
 *
 * Ako aplikaciju postavljate na hosting, promijenite vrijednosti
 * DB_HOST, DB_USER i DB_PASSWORD prema podacima hostinga.
 */


const DB_HOST = 'localhost';
const DB_NAME = 'hajvazi';
const DB_USER = 'root';
const DB_PASSWORD = '';


return [
    /*
     * DSN određuje MySQL server, naziv baze i UTF-8 kodiranje.
     */
    'dsn' =>
        'mysql:host=' . DB_HOST .
        ';dbname=' . DB_NAME .
        ';charset=utf8mb4',

    /*
     * MySQL korisničko ime.
     */
    'user' => DB_USER,

    /*
     * MySQL lozinka.
     */
    'password' => DB_PASSWORD
];
