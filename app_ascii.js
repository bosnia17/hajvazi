"use strict";

/*
 * Donacije MZ
 *
 * Ovaj fajl:
 * - u\u010ditava projekte i statistiku iz api.php
 * - pravi kartice projekata
 * - prikazuje detalje projekta
 * - dodaje nove projekte, donacije i rashode
 */


/* =========================================================
   GLOBALNE VRIJEDNOSTI I FORMATIRANJE
   ========================================================= */

const MONEY_FORMATTERS = {
    BAM: new Intl.NumberFormat("bs-BA", {
        style: "currency",
        currency: "BAM",
        minimumFractionDigits: 2
    }),
    EUR: new Intl.NumberFormat("bs-BA", {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2
    })
};

const EUR_TO_BAM = 1.94;

const DATE_FORMAT = new Intl.DateTimeFormat("bs-BA");

let projectsData = [];
let currentProject = null;
let currentDonations = [];
let currentExpenses = [];


function formatMoney(value, currency = "BAM") {
    const selectedCurrency =
        currency === "EUR" ? "EUR" : "BAM";

    return MONEY_FORMATTERS[selectedCurrency].format(
        numberValue(value)
    );
}


function currencySymbol(currency) {
    return currency === "EUR" ? "\u20ac" : "KM";
}


function totalsByCurrency(items) {
    return items.reduce(
        (totals, item) => {
            const currency = item.valuta === "EUR" ? "EUR" : "BAM";
            totals[currency] += numberValue(item.iznos);
            return totals;
        },
        {BAM: 0, EUR: 0}
    );
}


function totalInBam(totals) {
    return totals.BAM + totals.EUR * EUR_TO_BAM;
}


/**
 * Za\u0161tita teksta prije prikazivanja unutar HTML-a.
 */
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}


/**
 * Formatiranje datuma iz baze, npr. 2026-08-18.
 */
function formatDate(value) {
    if (!value) {
        return "Nije odre\u0111eno";
    }

    const date = new Date(value + "T00:00:00");

    if (Number.isNaN(date.getTime())) {
        return escapeHtml(value);
    }

    return DATE_FORMAT.format(date);
}


/**
 * Pretvaranje vrijednosti u broj.
 */
function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}


/**
 * Bootstrap boja prema statusu projekta.
 */
function statusColor(status) {
    const colors = {
        planiran: "warning",
        aktivan: "success",
        zavrsen: "primary",
        obustavljen: "secondary"
    };

    return colors[status] || "secondary";
}


/**
 * Naziv statusa za prikaz.
 */
function statusName(status) {
    const names = {
        planiran: "Planiran",
        aktivan: "Aktivan",
        zavrsen: "Zavr\u0161en",
        obustavljen: "Obustavljen"
    };

    return names[status] || status;
}


/**
 * Naziv na\u010dina donacije.
 */
function paymentName(payment) {
    const names = {
        gotovina: "Gotovina",
        racun: "Bankovni ra\u010dun",
        roba_usluga: "Roba ili usluga"
    };

    return names[payment] || payment;
}


/**
 * Ikona na\u010dina donacije.
 */
function paymentIcon(payment) {
    const icons = {
        gotovina: "cash",
        racun: "bank",
        roba_usluga: "box-seam"
    };

    return icons[payment] || "heart";
}


/**
 * Inicijali donatora.
 */
function initials(name) {
    const parts = String(name ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (!parts.length) {
        return "D";
    }

    return parts
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join("");
}


/* =========================================================
   MODALI
   ========================================================= */

function openModal(id) {
    const dialog = document.getElementById(id);

    if (dialog && !dialog.open) {
        dialog.showModal();
    }
}


function closeModal(id) {
    const dialog = document.getElementById(id);

    if (dialog && dialog.open) {
        dialog.close();
    }
}


/*
 * Namjerno nema zatvaranja modala klikom na pozadinu.
 *
 * Neki preglednici klik na stavku otvorenog <select> menija
 * prijave kao klik na <dialog>, zbog \u010dega bi se forma zatvorila.
 *
 * Modal se zatvara samo:
 * - dugmetom za zatvaranje
 * - dugmetom Odustani
 * - tipkom Escape, \u0161to <dialog> podr\u017eava automatski
 */


/* =========================================================
   KOMUNIKACIJA SA API-JEM
   ========================================================= */

async function api(action, options = {}) {
    const response = await fetch("api.php?action=" + action, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
        ...options
    });

    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error("Server nije vratio ispravan odgovor.");
    }

    if (!response.ok) {
        throw new Error(data.error || "Do\u0161lo je do gre\u0161ke.");
    }

    return data;
}


/* =========================================================
   OBAVIJESTI
   ========================================================= */

function showMessage(message, type = "success") {
    const oldMessage = document.getElementById("appMessage");

    if (oldMessage) {
        oldMessage.remove();
    }

    const element = document.createElement("div");
    element.id = "appMessage";
    element.className =
        "alert alert-" + type +
        " position-fixed top-0 start-50 translate-middle-x mt-3 shadow";

    element.style.zIndex = "9999";
    element.style.minWidth = "min(420px, 90vw)";
    element.textContent = message;

    document.body.appendChild(element);

    window.setTimeout(() => {
        element.remove();
    }, 3500);
}


/* =========================================================
   U\u010cITAVANJE PO\u010cETNE STRANICE
   ========================================================= */

async function load() {
    const projectsContainer = document.getElementById("projects");

    projectsContainer.innerHTML = `
        <div class="col-12 text-center py-5">
            <div class="spinner-border text-success" role="status">
                <span class="visually-hidden">U\u010ditavanje...</span>
            </div>
        </div>
    `;

    try {
        const data = await api("dashboard");

        projectsData = Array.isArray(data.projekti)
            ? data.projekti
            : [];

        renderStatistics(data.ukupno || {});
        renderProjects(projectsData);

    } catch (error) {
        document.getElementById("stats").innerHTML = "";

        projectsContainer.innerHTML = `
            <div class="col-12">
                <div class="alert alert-danger">
                    <strong>Gre\u0161ka:</strong>
                    ${escapeHtml(error.message)}
                </div>
            </div>
        `;
    }
}


/* =========================================================
   UKUPNA STATISTIKA
   ========================================================= */

function renderStatistics(totals) {
    const income = totals.prihodi || {};
    const expenses = totals.rashodi || {};
    const balance = totals.saldo || {};

    document.getElementById("stats").innerHTML = `
        <div class="col-md-4">
            <div class="summary-card">
                <div>
                    <span>UKUPNI PRIHODI</span>
                    <strong>${formatMoney(income.ukupno_km, "BAM")}</strong>
                    <small class="d-block text-secondary mt-1">
                        ${formatMoney(income.BAM, "BAM")} +
                        ${formatMoney(income.EUR, "EUR")}
                    </small>
                </div>

                <div class="summary-icon income">
                    <i class="bi bi-arrow-down-circle"></i>
                </div>
            </div>
        </div>

        <div class="col-md-4">
            <div class="summary-card">
                <div>
                    <span>UKUPNI RASHODI</span>
                    <strong>${formatMoney(expenses.ukupno_km, "BAM")}</strong>
                    <small class="d-block text-secondary mt-1">
                        ${formatMoney(expenses.BAM, "BAM")} +
                        ${formatMoney(expenses.EUR, "EUR")}
                    </small>
                </div>

                <div class="summary-icon expense">
                    <i class="bi bi-arrow-up-circle"></i>
                </div>
            </div>
        </div>

        <div class="col-md-4">
            <div class="summary-card">
                <div>
                    <span>RASPOLO\u017dIVO STANJE</span>
                    <strong>${formatMoney(balance.ukupno_km, "BAM")}</strong>
                    <small class="d-block text-secondary mt-1">
                        Kurs: 1 \u20ac = ${EUR_TO_BAM.toFixed(2)} KM
                    </small>
                </div>

                <div class="summary-icon balance">
                    <i class="bi bi-wallet2"></i>
                </div>
            </div>
        </div>
    `;
}


/* =========================================================
   KARTICE PROJEKATA
   ========================================================= */

function renderProjects(projects) {
    const container = document.getElementById("projects");

    if (!projects.length) {
        container.innerHTML = `
            <div class="col-12">
                <div class="empty-state">
                    <i class="bi bi-folder2-open"></i>
                    <h3>Nema evidentiranih projekata</h3>
                    <p class="mb-0">
                        Dodajte prvi projekat klikom na dugme
                        \u201eNovi projekat\u201c.
                    </p>
                </div>
            </div>
        `;

        return;
    }

    container.innerHTML = projects
        .map(projectCard)
        .join("");
}


function projectCard(project) {
    const incomeBam = numberValue(project.prihodi_bam);
    const incomeEur = numberValue(project.prihodi_eur);
    const expensesBam = numberValue(project.rashodi_bam);
    const expensesEur = numberValue(project.rashodi_eur);
    const incomeKm = numberValue(project.prihodi_km);
    const expensesKm = numberValue(project.rashodi_km);
    const balanceKm = numberValue(project.saldo_km);
    const goal = numberValue(project.cilj);
    const currency = project.valuta === "EUR" ? "EUR" : "BAM";
    const incomeForGoal =
        currency === "EUR" ? incomeKm / EUR_TO_BAM : incomeKm;

    const percentage = goal > 0
        ? Math.min(100, (incomeForGoal / goal) * 100)
        : 0;

    const progress = goal > 0
        ? `
            <div class="d-flex justify-content-between small mb-2">
                <span class="text-secondary">Prikupljeno</span>

                <strong>
                    ${formatMoney(incomeForGoal, currency)} od
                    ${formatMoney(goal, currency)}
                </strong>
            </div>

            <div
                class="progress mb-4"
                role="progressbar"
                aria-valuenow="${percentage}"
                aria-valuemin="0"
                aria-valuemax="100"
            >
                <div
                    class="progress-bar bg-success"
                    style="width: ${percentage}%"
                >
                    ${percentage.toFixed(0)}%
                </div>
            </div>
        `
        : `
            <div class="alert alert-light border small mb-4">
                Ciljani iznos nije postavljen.
            </div>
        `;

    return `
        <div class="col-12 col-md-6 col-xl-4">
            <article class="card project-card h-100 border-0 shadow-sm">

                <div class="card-body p-4">

                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <span
                            class="badge rounded-pill text-bg-${statusColor(project.status)}"
                        >
                            ${escapeHtml(statusName(project.status))}
                        </span>

                        <span class="text-secondary small">
                            <i class="bi bi-calendar3 me-1"></i>
                            ${formatDate(project.datum_pocetka)}
                        </span>
                    </div>

                    <h3 class="h5 fw-bold mb-2">
                        ${escapeHtml(project.naziv)}
                    </h3>

                    <p class="text-secondary small project-description mb-4">
                        ${escapeHtml(
                            project.opis || "Projekat nema dodatni opis."
                        )}
                    </p>

                    <div class="d-flex align-items-center mb-4">
                        <div class="project-icon me-3">
                            <i class="bi bi-person"></i>
                        </div>

                        <div>
                            <span class="project-label">
                                ODGOVORNA OSOBA
                            </span>

                            <strong class="d-block">
                                ${escapeHtml(project.odgovorna_osoba)}
                            </strong>

                            <a
                                class="small text-success text-decoration-none"
                                href="tel:${escapeHtml(project.kontakt)}"
                            >
                                <i class="bi bi-telephone me-1"></i>
                                ${escapeHtml(project.kontakt)}
                            </a>
                        </div>
                    </div>

                    ${progress}

                    <div class="finance-box row g-0 text-center mb-4">

                        <div class="col-4">
                            <span>Prihodi</span>
                            <strong class="text-success">
                                ${formatMoney(incomeBam, "BAM")}
                                <small class="d-block">
                                    ${formatMoney(incomeEur, "EUR")}
                                </small>
                            </strong>
                        </div>

                        <div class="col-4 border-start border-end">
                            <span>Rashodi</span>
                            <strong class="text-danger">
                                ${formatMoney(expensesBam, "BAM")}
                                <small class="d-block">
                                    ${formatMoney(expensesEur, "EUR")}
                                </small>
                            </strong>
                        </div>

                        <div class="col-4">
                            <span>Saldo</span>
                            <strong>
                                ${formatMoney(balanceKm, "BAM")}
                            </strong>
                        </div>

                    </div>

                    <button
                        type="button"
                        class="btn btn-outline-success w-100"
                        onclick="details(${Number(project.id)})"
                    >
                        <i class="bi bi-eye me-2"></i>
                        Pregled projekta
                    </button>

                </div>

            </article>
        </div>
    `;
}


/* =========================================================
   DETALJNI PREGLED PROJEKTA
   ========================================================= */

async function details(projectId) {
    const detailContainer = document.getElementById("detail");

    detailContainer.innerHTML = `
        <div class="text-center py-5">
            <div class="spinner-border text-success" role="status">
                <span class="visually-hidden">U\u010ditavanje...</span>
            </div>
        </div>
    `;

    openModal("detailModal");

    try {
        const data = await api(
            "projekat&id=" + encodeURIComponent(projectId)
        );

        const project = data.projekat;
        const donations = Array.isArray(data.donacije)
            ? data.donacije
            : [];
        const expenses = Array.isArray(data.rashodi)
            ? data.rashodi
            : [];

        currentProject = project;
        currentDonations = donations;
        currentExpenses = expenses;

        const incomeTotals = totalsByCurrency(donations);
        const expenseTotals = totalsByCurrency(expenses);
        const incomeKm = totalInBam(incomeTotals);
        const expensesKm = totalInBam(expenseTotals);
        const balanceKm = incomeKm - expensesKm;
        const goal = numberValue(project.cilj);
        const currency =
            project.valuta === "EUR" ? "EUR" : "BAM";
        const incomeForGoal =
            currency === "EUR" ? incomeKm / EUR_TO_BAM : incomeKm;

        const percentage = goal > 0
            ? Math.min(100, (incomeForGoal / goal) * 100)
            : 0;

        detailContainer.innerHTML = `
            <div class="project-detail">

                ${detailHeader(project)}

                <div class="detail-body">

                    ${projectInformation(project)}

                    ${projectStatistics(
                        incomeTotals,
                        expenseTotals,
                        balanceKm,
                        donations.length
                    )}

                    ${projectProgress(
                        goal,
                        incomeForGoal,
                        percentage,
                        currency
                    )}

                    ${projectTabs(
                        Number(project.id),
                        donations,
                        expenses,
                        currency
                    )}

                </div>

                <div class="detail-footer">
                    <span class="small text-secondary">
                        Finansijski pregled projekta
                    </span>

                    <button
                        type="button"
                        class="btn btn-light border"
                        onclick="closeModal('detailModal')"
                    >
                        Zatvori
                    </button>
                </div>

            </div>
        `;

    } catch (error) {
        detailContainer.innerHTML = `
            <div class="p-4">
                <div class="alert alert-danger mb-3">
                    ${escapeHtml(error.message)}
                </div>

                <button
                    type="button"
                    class="btn btn-light border"
                    onclick="closeModal('detailModal')"
                >
                    Zatvori
                </button>
            </div>
        `;
    }
}


function detailHeader(project) {
    return `
        <div class="detail-header">

            <div class="d-flex justify-content-between align-items-start gap-3">

                <div>
                    <span
                        class="badge rounded-pill text-bg-${statusColor(project.status)} mb-2"
                    >
                        ${escapeHtml(statusName(project.status))}
                    </span>

                    <h2 class="fw-bold mb-2">
                        ${escapeHtml(project.naziv)}
                    </h2>

                    <p class="text-secondary mb-0">
                        ${escapeHtml(project.opis || "Projekat nema dodatni opis.")}
                    </p>
                </div>

                <div class="d-flex align-items-center gap-2">
                    <button
                        type="button"
                        class="btn btn-sm btn-outline-primary"
                        onclick="editProject()"
                    >
                        <i class="bi bi-pencil me-1"></i>
                        Izmijeni
                    </button>

                    <button
                        type="button"
                        class="btn btn-sm btn-outline-danger"
                        onclick="deleteProject(${Number(project.id)})"
                    >
                        <i class="bi bi-trash me-1"></i>
                        Obri\u0161i
                    </button>

                    <button
                        type="button"
                        class="btn-close ms-2"
                        aria-label="Zatvori"
                        onclick="closeModal('detailModal')"
                    ></button>
                </div>

            </div>

        </div>
    `;
}


function projectInformation(project) {
    return `
        <div class="row g-3 mb-4">

            ${informationCard(
                "calendar-event",
                "Po\u010detak projekta",
                formatDate(project.datum_pocetka)
            )}

            ${informationCard(
                "calendar-check",
                "Planirani zavr\u0161etak",
                formatDate(project.datum_zavrsetka)
            )}

            ${informationCard(
                "person",
                "Odgovorna osoba",
                project.odgovorna_osoba
            )}

            ${informationCard(
                "telephone",
                "Kontakt",
                project.kontakt
            )}

        </div>
    `;
}


function informationCard(icon, label, value) {
    return `
        <div class="col-sm-6 col-lg-3">
            <div class="detail-info-card">

                <div class="project-icon">
                    <i class="bi bi-${icon}"></i>
                </div>

                <div>
                    <span>${escapeHtml(label)}</span>
                    <strong>${escapeHtml(value || "Nije navedeno")}</strong>
                </div>

            </div>
        </div>
    `;
}


function projectStatistics(
    income,
    expenses,
    balanceKm,
    donors
) {
    return `
        <div class="row g-3 mb-4">

            ${detailStatistic(
                "Ukupni prihodi",
                formatMoney(income.BAM, "BAM") +
                    " + " + formatMoney(income.EUR, "EUR"),
                "arrow-down-circle",
                "income-card"
            )}

            ${detailStatistic(
                "Ukupni rashodi",
                formatMoney(expenses.BAM, "BAM") +
                    " + " + formatMoney(expenses.EUR, "EUR"),
                "arrow-up-circle",
                "expense-card"
            )}

            ${detailStatistic(
                "Saldo ukupno u KM",
                formatMoney(balanceKm, "BAM"),
                "wallet2",
                "balance-card"
            )}

            ${detailStatistic(
                "Broj donacija",
                donors,
                "people",
                "donors-card"
            )}

        </div>
    `;
}


function detailStatistic(label, value, icon, className) {
    return `
        <div class="col-sm-6 col-xl-3">
            <div class="detail-stat-card ${className}">

                <div>
                    <span>${escapeHtml(label)}</span>
                    <strong>${escapeHtml(value)}</strong>
                </div>

                <i class="bi bi-${icon}"></i>

            </div>
        </div>
    `;
}


function projectProgress(goal, income, percentage, currency) {
    if (goal <= 0) {
        return `
            <div class="alert alert-light border mb-4">
                <i class="bi bi-info-circle me-2"></i>
                Ciljani iznos za ovaj projekat nije postavljen.
            </div>
        `;
    }

    const remaining = Math.max(0, goal - income);

    return `
        <div class="project-progress-box mb-4">

            <div class="d-flex justify-content-between align-items-center gap-3">

                <div>
                    <h3 class="h6 fw-bold mb-1">
                        Napredak prikupljanja sredstava
                    </h3>

                    <span class="text-secondary small">
                        Ciljani iznos:
                        ${formatMoney(goal, currency)}
                    </span>
                </div>

                <strong class="progress-percentage">
                    ${percentage.toFixed(1)}%
                </strong>

            </div>

            <div class="progress mt-3">
                <div
                    class="progress-bar bg-success"
                    style="width: ${percentage}%"
                ></div>
            </div>

            <div class="d-flex justify-content-between flex-wrap gap-2 mt-2 small">
                <span class="text-success fw-semibold">
                    Prikupljeno:
                    ${formatMoney(income, currency)}
                </span>

                <span class="text-secondary">
                    Nedostaje:
                    ${formatMoney(remaining, currency)}
                </span>
            </div>

        </div>
    `;
}


/* =========================================================
   TABOVI: DONACIJE, RASHODI I NOVI UNOS
   ========================================================= */

function projectTabs(
    projectId,
    donations,
    expenses,
    currency
) {
    return `
        <ul
            class="nav nav-pills project-tabs mb-4"
            role="tablist"
        >

            <li class="nav-item" role="presentation">
                <button
                    type="button"
                    class="nav-link active"
                    data-bs-toggle="pill"
                    data-bs-target="#donationsTab"
                >
                    <i class="bi bi-heart me-2"></i>
                    Prihodi
                    <span class="badge rounded-pill ms-1">
                        ${donations.length}
                    </span>
                </button>
            </li>

            <li class="nav-item" role="presentation">
                <button
                    type="button"
                    class="nav-link"
                    data-bs-toggle="pill"
                    data-bs-target="#expensesTab"
                >
                    <i class="bi bi-receipt me-2"></i>
                    Rashodi
                    <span class="badge rounded-pill ms-1">
                        ${expenses.length}
                    </span>
                </button>
            </li>

            <li class="nav-item" role="presentation">
                <button
                    type="button"
                    class="nav-link"
                    data-bs-toggle="pill"
                    data-bs-target="#newEntryTab"
                >
                    <i class="bi bi-plus-circle me-2"></i>
                    Novi unos
                </button>
            </li>

        </ul>


        <div class="tab-content">

            <div
                id="donationsTab"
                class="tab-pane fade show active"
            >
                ${donationTable(donations, currency)}
            </div>

            <div
                id="expensesTab"
                class="tab-pane fade"
            >
                ${expenseTable(expenses, currency)}
            </div>

            <div
                id="newEntryTab"
                class="tab-pane fade"
            >
                ${entryForms(projectId, currency)}
            </div>

        </div>
    `;
}


/* =========================================================
   TABELA DONACIJA
   ========================================================= */

function donationTable(donations, currency) {
    if (!donations.length) {
        return `
            <div class="empty-state py-5">
                <i class="bi bi-heart"></i>
                <h3>Nema evidentiranih prihoda</h3>
                <p class="mb-0">
                    Prihod možete dodati u tabu \u201eNovi unos\u201c.
                </p>
            </div>
        `;
    }

    const rows = donations.map(donation => `
        <tr>
            <td>
                <div class="d-flex align-items-center">
                    <div class="donor-avatar me-3">
                        ${escapeHtml(initials(donation.donator))}
                    </div>

                    <div>
                        <strong>
                            ${escapeHtml(donation.donator)}
                        </strong>

                        <span class="d-block text-secondary small">
                            ${escapeHtml(
                                donation.kontakt  
                            )}
                        </span>
                    </div>
                </div>
            </td>

            <td>${formatDate(donation.datum)}</td>

            <td>
                <span class="payment-badge">
                    <i class="bi bi-${paymentIcon(donation.nacin)} me-1"></i>
                    ${escapeHtml(paymentName(donation.nacin))}
                </span>
            </td>

            <td class="text-end">
                <strong class="text-success">
                    ${formatMoney(donation.iznos, donation.valuta)}
                </strong>
            </td>

            <td class="text-end text-nowrap">
                <button
                    class="btn btn-sm btn-light border"
                    onclick="editDonation(${Number(donation.id)})"
                    title="Izmijeni prihod"
                >
                    <i class="bi bi-pencil"></i>
                </button>
                <button
                    class="btn btn-sm btn-outline-danger"
                    onclick="deleteDonation(${Number(donation.id)})"
                    title="Obriši prihod"
                >
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `).join("");

    return `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <div>
                <h3 class="h5 fw-bold mb-1">
                    Evidencija prihoda
                </h3>

                <p class="small text-secondary mb-0">
                    Pregled svih evidentiranih prihoda.
                </p>
            </div>
        </div>

        <div class="table-responsive project-table">
            <table class="table align-middle">
                <thead>
                    <tr>
                        <th>Ime i prezime</th>
                        <th>Datum</th>
                        <th>Vrsta prihoda</th>
                        <th class="text-end">Iznos</th>
                        <th class="text-end">Akcije</th>
                    </tr>
                </thead>

                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}


/* =========================================================
   TABELA RASHODA
   ========================================================= */

function expenseTable(expenses, currency) {
    if (!expenses.length) {
        return `
            <div class="empty-state py-5">
                <i class="bi bi-receipt"></i>
                <h3>Nema evidentiranih rashoda</h3>
                <p class="mb-0">
                    Rashod mo\u017eete dodati u tabu \u201eNovi unos\u201c.
                </p>
            </div>
        `;
    }

    const rows = expenses.map(expense => `
        <tr>
            <td>
                <strong>${escapeHtml(expense.opis)}</strong>
            </td>

            <td>
                ${escapeHtml(expense.dobavljac || "Nije navedeno")}
            </td>

            <td>${formatDate(expense.datum)}</td>

            <td>
                ${escapeHtml(expense.broj_racuna || "\u2014")}
            </td>

            <td class="text-end">
                <strong class="text-danger">
                    ${formatMoney(expense.iznos, expense.valuta)}
                </strong>
            </td>

            <td class="text-end text-nowrap">
                <button
                    class="btn btn-sm btn-light border"
                    onclick="editExpense(${Number(expense.id)})"
                    title="Izmijeni rashod"
                >
                    <i class="bi bi-pencil"></i>
                </button>
                <button
                    class="btn btn-sm btn-outline-danger"
                    onclick="deleteExpense(${Number(expense.id)})"
                    title="Obri\u0161i rashod"
                >
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `).join("");

    return `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <div>
                <h3 class="h5 fw-bold mb-1">
                    Evidencija rashoda
                </h3>

                <p class="small text-secondary mb-0">
                    Pregled utro\u0161enih sredstava projekta.
                </p>
            </div>
        </div>

        <div class="table-responsive project-table">
            <table class="table align-middle">
                <thead>
                    <tr>
                        <th>Opis</th>
                        <th>Dobavlja\u010d</th>
                        <th>Datum</th>
                        <th>Broj ra\u010duna</th>
                        <th class="text-end">Iznos</th>
                        <th class="text-end">Akcije</th>
                    </tr>
                </thead>

                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}


/* =========================================================
   FORME ZA NOVU DONACIJU I RASHOD
   ========================================================= */

function entryForms(projectId, currency) {
    const today = new Date().toISOString().slice(0, 10);

    return `
        <div class="row g-4">

            <div class="col-lg-6">
                <form
                    class="entry-form-box"
                    onsubmit="addEntry(event, 'donacije', ${projectId})"
                >
                    <h3 class="h5 fw-bold mb-3">
                        <i class="bi bi-heart text-success me-2"></i>
                        Novi prihod
                    </h3>

                    <div class="mb-3">
                        <label class="form-label">Donator</label>
                        <input
                            type="text"
                            name="donator"
                            class="form-control"
                            placeholder="Ime i prezime ili naziv firme"
                            required
                        >
                    </div>

                    <div class="row g-3 mb-3">
                        <div class="col-sm-4">
                            <label class="form-label">Iznos</label>
                            <input
                                type="number"
                                name="iznos"
                                class="form-control"
                                min="0.01"
                                step="0.01"
                                required
                            >
                        </div>

                        <div class="col-sm-4">
                            <label class="form-label">Valuta</label>
                            <select name="valuta" class="form-select">
                                <option value="BAM" ${currency === "BAM" ? "selected" : ""}>KM</option>
                                <option value="EUR" ${currency === "EUR" ? "selected" : ""}>EUR</option>
                            </select>
                        </div>

                        <div class="col-sm-4">
                            <label class="form-label">Datum</label>
                            <input
                                type="date"
                                name="datum"
                                class="form-control"
                                value="${today}"
                                required
                            >
                        </div>
                    </div>

                    <div class="mb-3">
                        <label class="form-label">Kontakt</label>
                        <input
                            type="text"
                            name="kontakt"
                            class="form-control"
                            placeholder="Kontakt nije obavezan"
                        >
                    </div>

                    <div class="mb-3">
                        <label class="form-label">Vrsta prihoda</label>

                        <select name="nacin" class="form-select">
                            <option value="gotovina">Gotovina</option>
                            <option value="racun">Bankovni ra\u010dun</option>
                            <option value="roba_usluga">Roba ili usluga</option>
                        </select>
                    </div>

                    <div class="mb-3">
                        <label class="form-label">Napomena</label>
                        <input
                            type="text"
                            name="napomena"
                            class="form-control"
                        >
                    </div>

                    <button type="submit" class="btn btn-success w-100">
                        <i class="bi bi-check-circle me-2"></i>
                        Sačuvaj prihod
                    </button>
                </form>
            </div>


            <div class="col-lg-6">
                <form
                    class="entry-form-box"
                    onsubmit="addEntry(event, 'rashodi', ${projectId})"
                >
                    <h3 class="h5 fw-bold mb-3">
                        <i class="bi bi-receipt text-danger me-2"></i>
                        Novi rashod
                    </h3>

                    <div class="mb-3">
                        <label class="form-label">Opis rashoda</label>
                        <input
                            type="text"
                            name="opis"
                            class="form-control"
                            placeholder="Npr. nabavka materijala"
                            required
                        >
                    </div>

                    <div class="row g-3 mb-3">
                        <div class="col-sm-4">
                            <label class="form-label">Iznos</label>
                            <input
                                type="number"
                                name="iznos"
                                class="form-control"
                                min="0.01"
                                step="0.01"
                                required
                            >
                        </div>

                        <div class="col-sm-4">
                            <label class="form-label">Valuta</label>
                            <select name="valuta" class="form-select">
                                <option value="BAM" ${currency === "BAM" ? "selected" : ""}>KM</option>
                                <option value="EUR" ${currency === "EUR" ? "selected" : ""}>EUR</option>
                            </select>
                        </div>

                        <div class="col-sm-4">
                            <label class="form-label">Datum</label>
                            <input
                                type="date"
                                name="datum"
                                class="form-control"
                                value="${today}"
                                required
                            >
                        </div>
                    </div>

                    <div class="mb-3">
                        <label class="form-label">Dobavlja\u010d</label>
                        <input
                            type="text"
                            name="dobavljac"
                            class="form-control"
                        >
                    </div>

                    <div class="mb-3">
                        <label class="form-label">Broj ra\u010duna</label>
                        <input
                            type="text"
                            name="broj_racuna"
                            class="form-control"
                        >
                    </div>

                    <button type="submit" class="btn btn-danger w-100">
                        <i class="bi bi-check-circle me-2"></i>
                        Sa\u010duvaj rashod
                    </button>
                </form>
            </div>

        </div>
    `;
}


/* =========================================================
   IZMJENA I BRISANJE POSTOJE\u0106IH ZAPISA
   ========================================================= */

function editorDialog() {
    let dialog = document.getElementById("editRecordModal");

    if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.id = "editRecordModal";
        document.body.appendChild(dialog);
    }

    return dialog;
}


function openEditor(title, fieldsHtml, submitHandler) {
    const dialog = editorDialog();

    dialog.innerHTML = `
        <form id="editRecordForm">
            <div class="dialog-header d-flex justify-content-between">
                <div>
                    <h2 class="h4 fw-bold mb-1">${escapeHtml(title)}</h2>
                    <p class="small text-secondary mb-0">
                        Izmijenite podatke i sa\u010duvajte promjene.
                    </p>
                </div>
                <button
                    type="button"
                    class="btn-close"
                    onclick="closeModal('editRecordModal')"
                ></button>
            </div>
            <div class="dialog-body">${fieldsHtml}</div>
            <div class="dialog-footer">
                <button
                    type="button"
                    class="btn btn-light border"
                    onclick="closeModal('editRecordModal')"
                >
                    Odustani
                </button>
                <button type="submit" class="btn btn-primary">
                    <i class="bi bi-check-circle me-2"></i>
                    Sa\u010duvaj promjene
                </button>
            </div>
        </form>
    `;

    dialog.querySelector("#editRecordForm")
        .addEventListener("submit", submitHandler);

    openModal("editRecordModal");
}


function editProject() {
    const project = currentProject;
    if (!project) return;

    openEditor("Izmjena projekta", `
        <label class="form-label w-100">Naziv
            <input class="form-control" name="naziv"
                value="${escapeHtml(project.naziv)}" required>
        </label>
        <label class="form-label w-100 mt-3">Opis
            <textarea class="form-control" name="opis"
                rows="3">${escapeHtml(project.opis || "")}</textarea>
        </label>
        <div class="row g-3 mt-0">
            <div class="col-md-6"><label class="form-label w-100">Po\u010detak
                <input class="form-control" type="date" name="datum_pocetka"
                    value="${escapeHtml(project.datum_pocetka)}" required>
            </label></div>
            <div class="col-md-6"><label class="form-label w-100">Zavr\u0161etak
                <input class="form-control" type="date" name="datum_zavrsetka"
                    value="${escapeHtml(project.datum_zavrsetka || "")}">
            </label></div>
        </div>
        <div class="row g-3 mt-0">
            <div class="col-md-4"><label class="form-label w-100">Cilj
                <input class="form-control" type="number" step=".01" min="0"
                    name="cilj" value="${escapeHtml(project.cilj || "")}">
            </label></div>
            <div class="col-md-4"><label class="form-label w-100">Valuta
                <select class="form-select" name="valuta">
                    <option value="BAM" ${project.valuta === "BAM" ? "selected" : ""}>KM</option>
                    <option value="EUR" ${project.valuta === "EUR" ? "selected" : ""}>EUR</option>
                </select>
            </label></div>
            <div class="col-md-4"><label class="form-label w-100">Status
                <select class="form-select" name="status">
                    ${["planiran","aktivan","zavrsen","obustavljen"].map(
                        status => `<option value="${status}" ${project.status === status ? "selected" : ""}>${statusName(status)}</option>`
                    ).join("")}
                </select>
            </label></div>
        </div>
        <div class="row g-3 mt-0">
            <div class="col-md-6"><label class="form-label w-100">Odgovorna osoba
                <input class="form-control" name="odgovorna_osoba"
                    value="${escapeHtml(project.odgovorna_osoba)}" required>
            </label></div>
            <div class="col-md-6"><label class="form-label w-100">Kontakt
                <input class="form-control" name="kontakt"
                    value="${escapeHtml(project.kontakt)}" required>
            </label></div>
        </div>
        <div class="alert alert-warning small mt-3 mb-0">
            Promjena valute mijenja oznaku svih postojećih prihoda i rashoda
            ovog projekta, bez preračunavanja iznosa.
        </div>
    `, async event => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));

        try {
            await api("projekti&id=" + project.id, {
                method: "PUT",
                body: JSON.stringify(data)
            });
            closeModal("editRecordModal");
            showMessage("Projekat je uspje\u0161no izmijenjen.");
            await load();
            await details(project.id);
        } catch (error) {
            showMessage(error.message, "danger");
        }
    });
}


async function deleteProject(id) {
    const confirmed = window.confirm(
        "Da li ste sigurni da želite obrisati ovaj projekat?\n\n" +
        "Bit će trajno obrisane i svi njegovi prihodi i rashodi."
    );

    if (!confirmed) return;

    try {
        await api("projekti&id=" + id, {method: "DELETE"});
        closeModal("detailModal");
        showMessage("Projekat je obrisan.");
        await load();
    } catch (error) {
        showMessage(error.message, "danger");
    }
}


function editDonation(id) {
    const donation = currentDonations.find(item => Number(item.id) === Number(id));
    if (!donation) return;

    openEditor("Izmjena donacije", `
        <label class="form-label w-100">Donator
            <input class="form-control" name="donator"
                value="${escapeHtml(donation.donator)}" required>
        </label>
        <div class="row g-3 mt-0">
            <div class="col-md-4"><label class="form-label w-100">Iznos
                <input class="form-control" type="number" step=".01" min=".01"
                    name="iznos" value="${escapeHtml(donation.iznos)}" required>
            </label></div>
            <div class="col-md-4"><label class="form-label w-100">Valuta
                <select class="form-select" name="valuta">
                    <option value="BAM" ${donation.valuta === "BAM" ? "selected" : ""}>KM</option>
                    <option value="EUR" ${donation.valuta === "EUR" ? "selected" : ""}>EUR</option>
                </select>
            </label></div>
            <div class="col-md-4"><label class="form-label w-100">Datum
                <input class="form-control" type="date" name="datum"
                    value="${escapeHtml(donation.datum)}" required>
            </label></div>
        </div>
        <label class="form-label w-100 mt-3">Kontakt
            <input class="form-control" name="kontakt"
                value="${escapeHtml(donation.kontakt || "")}">
        </label>
        <label class="form-label w-100 mt-3">Na\u010din
            <select class="form-select" name="nacin">
                ${["gotovina","racun","roba_usluga"].map(
                    method => `<option value="${method}" ${donation.nacin === method ? "selected" : ""}>${paymentName(method)}</option>`
                ).join("")}
            </select>
        </label>
        <label class="form-label w-100 mt-3">Napomena
            <input class="form-control" name="napomena"
                value="${escapeHtml(donation.napomena || "")}">
        </label>
    `, event => updateRecord(event, "donacije", id, "Prihod je izmjenjen."));
}


async function deleteDonation(id) {
    if (!window.confirm("Da li želite obrisati ovaj prihod?")) return;
    await deleteRecord("donacije", id, "Prihod je obrisan.");
}


function editExpense(id) {
    const expense = currentExpenses.find(item => Number(item.id) === Number(id));
    if (!expense) return;

    openEditor("Izmjena rashoda", `
        <label class="form-label w-100">Opis
            <input class="form-control" name="opis"
                value="${escapeHtml(expense.opis)}" required>
        </label>
        <div class="row g-3 mt-0">
            <div class="col-md-4"><label class="form-label w-100">Iznos
                <input class="form-control" type="number" step=".01" min=".01"
                    name="iznos" value="${escapeHtml(expense.iznos)}" required>
            </label></div>
            <div class="col-md-4"><label class="form-label w-100">Valuta
                <select class="form-select" name="valuta">
                    <option value="BAM" ${expense.valuta === "BAM" ? "selected" : ""}>KM</option>
                    <option value="EUR" ${expense.valuta === "EUR" ? "selected" : ""}>EUR</option>
                </select>
            </label></div>
            <div class="col-md-4"><label class="form-label w-100">Datum
                <input class="form-control" type="date" name="datum"
                    value="${escapeHtml(expense.datum)}" required>
            </label></div>
        </div>
        <label class="form-label w-100 mt-3">Dobavlja\u010d
            <input class="form-control" name="dobavljac"
                value="${escapeHtml(expense.dobavljac || "")}">
        </label>
        <label class="form-label w-100 mt-3">Broj ra\u010duna
            <input class="form-control" name="broj_racuna"
                value="${escapeHtml(expense.broj_racuna || "")}">
        </label>
    `, event => updateRecord(event, "rashodi", id, "Rashod je izmijenjen."));
}


async function deleteExpense(id) {
    if (!window.confirm("Da li \u017eelite obrisati ovaj rashod?")) return;
    await deleteRecord("rashodi", id, "Rashod je obrisan.");
}


async function updateRecord(event, type, id, message) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));

    try {
        await api(type + "&id=" + id, {
            method: "PUT",
            body: JSON.stringify(data)
        });
        closeModal("editRecordModal");
        showMessage(message);
        await load();
        await details(currentProject.id);
    } catch (error) {
        showMessage(error.message, "danger");
    }
}


async function deleteRecord(type, id, message) {
    try {
        await api(type + "&id=" + id, {method: "DELETE"});
        showMessage(message);
        await load();
        await details(currentProject.id);
    } catch (error) {
        showMessage(error.message, "danger");
    }
}


/* =========================================================
   SLANJE DONACIJE ILI RASHODA
   ========================================================= */

async function addEntry(event, type, projectId) {
    event.preventDefault();

    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const originalButtonContent = button.innerHTML;

    const data = Object.fromEntries(new FormData(form));
    data.projekat_id = projectId;

    button.disabled = true;
    button.innerHTML = `
        <span class="spinner-border spinner-border-sm me-2"></span>
        \u010cuvanje...
    `;

    try {
        await api(type, {
            method: "POST",
            body: JSON.stringify(data)
        });

        showMessage(
            type === "donacije"
                ? "Prihod je uspješno evidentiran."
                : "Rashod je uspješno evidentiran."
        );

        await load();
        await details(projectId);

    } catch (error) {
        showMessage(error.message, "danger");

    } finally {
        button.disabled = false;
        button.innerHTML = originalButtonContent;
    }
}


/* =========================================================
   DODAVANJE NOVOG PROJEKTA
   ========================================================= */

const projectForm = document.getElementById("projectForm");

projectForm.addEventListener("submit", async event => {
    event.preventDefault();

    const button = projectForm.querySelector('button[type="submit"]');
    const originalButtonContent = button.innerHTML;
    const data = Object.fromEntries(new FormData(projectForm));

    button.disabled = true;
    button.innerHTML = `
        <span class="spinner-border spinner-border-sm me-2"></span>
        \u010cuvanje...
    `;

    try {
        await api("projekti", {
            method: "POST",
            body: JSON.stringify(data)
        });

        projectForm.reset();
        closeModal("projectModal");

        showMessage("Projekat je uspje\u0161no sa\u010duvan.");

        await load();

    } catch (error) {
        showMessage(error.message, "danger");

    } finally {
        button.disabled = false;
        button.innerHTML = originalButtonContent;
    }
});


/* =========================================================
   PRETRAGA PROJEKATA
   ========================================================= */

const searchInput = document.getElementById("search");

searchInput.addEventListener("input", event => {
    const query = event.target.value
        .trim()
        .toLocaleLowerCase("bs");

    if (!query) {
        renderProjects(projectsData);
        return;
    }

    const filtered = projectsData.filter(project => {
        const searchableText = [
            project.naziv,
            project.opis,
            project.odgovorna_osoba,
            project.status
        ]
            .join(" ")
            .toLocaleLowerCase("bs");

        return searchableText.includes(query);
    });

    renderProjects(filtered);
});


/* =========================================================
   POKRETANJE APLIKACIJE
   ========================================================= */

load();
