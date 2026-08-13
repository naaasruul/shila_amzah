const DEFAULT_APP_DATA = {};

const FIRESTORE_DOC_PATH = 'app/state';

// Old client spreadsheets spelled the IC column differently per sheet
// (No. IC, IC No, Kad Pengenalan, Identity Card ID, ...). Map every
// known variant to one canonical header so it's a single, maskable field
// instead of N inconsistent columns.
const HEADER_ALIASES = {
    'no. ic': 'No. IC',
    'no ic': 'No. IC',
    'ic no': 'No. IC',
    'ic no.': 'No. IC',
    'ic number': 'No. IC',
    'no. kad pengenalan': 'No. IC',
    'no kad pengenalan': 'No. IC',
    'kad pengenalan': 'No. IC',
    'nombor kad pengenalan': 'No. IC',
    'identity card': 'No. IC',
    'identity card id': 'No. IC',
    'identity card no': 'No. IC',
    'identity card number': 'No. IC',
    'nric': 'No. IC',
    'nric no': 'No. IC',

    // Some sellers/reps list every attendee by name (1 row = 1 ticket).
    // Others act as a "wakil" and just report a bulk count for the group
    // they represent (1 row = N tickets). Both styles get normalized to
    // this one column so the dashboard can add them up consistently.
    'bilangan tiket': 'Bilangan Tiket',
    'bil tiket': 'Bilangan Tiket',
    'no. tiket': 'Bilangan Tiket',
    'nombor tiket': 'Bilangan Tiket',
    'jumlah tiket': 'Bilangan Tiket',
    'qty': 'Bilangan Tiket',
    'quantity': 'Bilangan Tiket',
    'bilangan peserta': 'Bilangan Tiket',
    'jumlah peserta': 'Bilangan Tiket',
    'bilangan orang': 'Bilangan Tiket',
    'jumlah orang': 'Bilangan Tiket',
    'bil peserta': 'Bilangan Tiket',
    'peserta': 'Bilangan Tiket',
    'participants': 'Bilangan Tiket',
    'number of tickets': 'Bilangan Tiket',
    'no of tickets': 'Bilangan Tiket',
};

const TICKET_HEADER = 'Bilangan Tiket';

// A row without this column (a plain name list) is 1 named person = 1
// ticket. A row with it holds however many tickets that entry covers,
// whether that's an individually listed attendee or a wakil's bulk count.
function getRowTicketCount(row) {
    const raw = row?.[TICKET_HEADER];
    const num = parseInt(raw, 10);
    return Number.isFinite(num) && num > 0 ? num : 1;
}

// Old sheets like "Attendees"/"Fans" only ever listed names one by one,
// so they never got a quantity column. Add it everywhere so any tab can
// take a single bulk entry (e.g. "Wakil X - 100 tiket") without forcing
// every attendee to be typed in by name.
function ensureTicketHeaderOnAllTabs() {
    Object.values(appData).forEach((tabData) => {
        if (!tabData.headers.includes(TICKET_HEADER)) {
            tabData.headers.push(TICKET_HEADER);
        }
    });
}

function computeDashboardStats() {
    const perTab = Object.entries(appData).map(([tabName, data]) => {
        const rows = data.rows || [];
        const tickets = rows.reduce((sum, row) => sum + getRowTicketCount(row), 0);
        return { tabName, entries: rows.length, tickets };
    });
    const totalTickets = perTab.reduce((sum, t) => sum + t.tickets, 0);
    const totalEntries = perTab.reduce((sum, t) => sum + t.entries, 0);
    return { perTab, totalTickets, totalEntries };
}

function renderDashboard() {
    const container = document.getElementById('dashboardSummary');
    if (!container) return;

    const { perTab, totalTickets, totalEntries } = computeDashboardStats();
    container.innerHTML = '';

    const ticketCard = document.createElement('div');
    ticketCard.className = 'dashboard-card';
    ticketCard.innerHTML = '<div class="dashboard-label">Jumlah Tiket</div>';
    const ticketValue = document.createElement('div');
    ticketValue.className = 'dashboard-value';
    ticketValue.textContent = totalTickets;
    ticketCard.appendChild(ticketValue);

    const entryCard = document.createElement('div');
    entryCard.className = 'dashboard-card';
    entryCard.innerHTML = '<div class="dashboard-label">Jumlah Rekod</div>';
    const entryValue = document.createElement('div');
    entryValue.className = 'dashboard-value';
    entryValue.textContent = totalEntries;
    entryCard.appendChild(entryValue);

    const breakdown = document.createElement('div');
    breakdown.className = 'dashboard-breakdown';
    breakdown.innerHTML = '<div class="dashboard-label">Mengikut Tab</div>';
    perTab.forEach(({ tabName, tickets, entries }) => {
        const row = document.createElement('div');
        row.className = 'dashboard-breakdown-row';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = tabName;
        const valueSpan = document.createElement('span');
        valueSpan.textContent = `${tickets} tiket (${entries} rekod)`;
        row.appendChild(nameSpan);
        row.appendChild(valueSpan);
        breakdown.appendChild(row);
    });

    container.appendChild(ticketCard);
    container.appendChild(entryCard);
    container.appendChild(breakdown);
}

const SENSITIVE_HEADER_PATTERN = /\bic\b|kad pengenalan|identity card|nric/i;

function normalizeHeader(raw) {
    const trimmed = String(raw ?? '').trim();
    const alias = HEADER_ALIASES[trimmed.toLowerCase()];
    return alias || trimmed;
}

function isSensitiveHeader(header) {
    return SENSITIVE_HEADER_PATTERN.test(String(header ?? ''));
}

function maskSensitiveValue(value) {
    const str = String(value ?? '');
    if (str.length <= 4) return '•'.repeat(str.length);
    return '•'.repeat(str.length - 4) + str.slice(-4);
}

function formatCellValue(header, value) {
    if (isSensitiveHeader(header) && value) {
        return maskSensitiveValue(value);
    }
    return value ?? '-';
}

function toggleMaskedCell(td) {
    const revealed = td.dataset.revealed === 'true';
    td.textContent = revealed ? maskSensitiveValue(td.dataset.raw) : td.dataset.raw;
    td.dataset.revealed = revealed ? 'false' : 'true';
}
let appData = {};
let activeTab = '';
let editingIndex = -1;
let firestoreDb = null;

function initFirebase() {
    if (!window.firebaseConfig || !window.firebaseConfig.apiKey) {
        console.warn('Firebase config not initialized. Data will be stored locally only.');
        return;
    }

    if (!window.firebase || !window.firebase.apps) {
        console.warn('Firebase SDK not loaded. Data will be stored locally only.');
        return;
    }

    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(window.firebaseConfig);
        }

        if (window.recaptchaSiteKey && firebase.appCheck) {
            firebase.appCheck().activate(window.recaptchaSiteKey, true);
        } else {
            console.warn('App Check not activated: set window.recaptchaSiteKey in js/firebase-config.js.');
        }

        firestoreDb = firebase.firestore();
    } catch (error) {
        console.warn('Firebase initialization failed:', error);
    }
}

async function loadData() {
    const localCached = loadFromLocalCache();
    if (firestoreDb) {
        try {
            const snapshot = await firestoreDb.doc(FIRESTORE_DOC_PATH).get();
            if (snapshot.exists) {
                const data = snapshot.data();
                if (data?.appData && Object.keys(data.appData).length) {
                    appData = data.appData;
                    activeTab = localCached && appData[localCached.activeTab] ? localCached.activeTab : data.activeTab || Object.keys(appData)[0];
                    updateSyncStatus('Diselaraskan dengan Firebase');
                    return;
                }
            }

            if (localCached) {
                appData = localCached.appData;
                activeTab = localCached.activeTab || Object.keys(appData)[0];
                await saveToFirebase();
                updateSyncStatus('Data tempatan disimpan ke Firebase');
                return;
            }
        } catch (error) {
            console.warn('Firebase load failed:', error);
            updateSyncStatus('Gunakan data tempatan sahaja');
        }
    }

    if (localCached) {
        appData = localCached.appData;
        activeTab = localCached.activeTab || Object.keys(appData)[0];
    } else {
        appData = JSON.parse(JSON.stringify(DEFAULT_APP_DATA));
        activeTab = Object.keys(appData)[0];
    }
}

function loadFromLocalCache() {
    const raw = localStorage.getItem('concertAppData');
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        console.warn('Local cache invalid:', error);
        return null;
    }
}

function saveLocalCache() {
    const payload = { appData, activeTab };
    localStorage.setItem('concertAppData', JSON.stringify(payload));
}

async function saveToFirebase() {
    if (!firestoreDb) return;
    try {
        await firestoreDb.doc(FIRESTORE_DOC_PATH).set({
            appData,
            activeTab,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        updateSyncStatus('Disimpan ke Firebase');
    } catch (error) {
        console.warn('Firebase save failed:', error);
        updateSyncStatus('Gagal menyimpan ke Firebase');
    }
}

function saveAppState() {
    saveLocalCache();
    if (firestoreDb) {
        saveToFirebase();
    }
}

function renderTabs() {
    const tabsNav = document.getElementById('tabsNav');
    tabsNav.innerHTML = '';

    Object.keys(appData).forEach((tabName) => {
        const btn = document.createElement('button');
        btn.className = `tab-btn ${tabName === activeTab ? 'active' : ''}`;
        btn.type = 'button';
        btn.addEventListener('click', () => switchTab(tabName));

        const label = document.createElement('span');
        label.textContent = tabName;
        btn.appendChild(label);

        const renameBtn = document.createElement('span');
        renameBtn.className = 'tab-btn-rename';
        renameBtn.textContent = '✎';
        renameBtn.title = `Tukar nama tab "${tabName}"`;
        renameBtn.addEventListener('click', (event) => renameTab(tabName, event));
        btn.appendChild(renameBtn);

        const closeBtn = document.createElement('span');
        closeBtn.className = 'tab-btn-close';
        closeBtn.textContent = '×';
        closeBtn.title = `Padam tab "${tabName}"`;
        closeBtn.addEventListener('click', (event) => deleteTab(tabName, event));
        btn.appendChild(closeBtn);

        tabsNav.appendChild(btn);
    });

    const addTabBtn = document.createElement('button');
    addTabBtn.className = 'tab-btn tab-btn-add';
    addTabBtn.type = 'button';
    addTabBtn.innerText = '+ Tab Baru';
    addTabBtn.addEventListener('click', openTabModal);
    tabsNav.appendChild(addTabBtn);
}

function switchTab(tabName) {
    activeTab = tabName;
    renderTabs();
    renderTable();
    saveAppState();
}

function renderTable() {
    const currentData = appData[activeTab];
    const tableHead = document.getElementById('tableHead');
    const tableBody = document.getElementById('tableBody');

    if (!currentData) {
        tableHead.innerHTML = '';
        tableBody.innerHTML = '';
        renderDashboard();
        return;
    }

    const headerRow = document.createElement('tr');
    currentData.headers.forEach((h) => {
        const th = document.createElement('th');
        th.textContent = h;
        headerRow.appendChild(th);
    });
    const actionsHeader = document.createElement('th');
    actionsHeader.textContent = 'Tindakan';
    headerRow.appendChild(actionsHeader);
    tableHead.innerHTML = '';
    tableHead.appendChild(headerRow);

    tableBody.innerHTML = '';
    currentData.rows.forEach((row, idx) => {
        const tr = document.createElement('tr');
        currentData.headers.forEach((h) => {
            const td = document.createElement('td');
            td.textContent = formatCellValue(h, row[h]);
            if (isSensitiveHeader(h) && row[h]) {
                td.classList.add('masked-cell');
                td.title = 'Klik untuk papar/sembunyi';
                td.dataset.raw = row[h];
                td.dataset.revealed = 'false';
                td.addEventListener('click', () => toggleMaskedCell(td));
            }
            tr.appendChild(td);
        });

        const actionsTd = document.createElement('td');
        actionsTd.className = 'action-btns';

        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-sm btn-secondary';
        editBtn.type = 'button';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => openEntryModal(idx));

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-sm btn-danger';
        delBtn.type = 'button';
        delBtn.textContent = 'Padam';
        delBtn.addEventListener('click', () => deleteEntry(idx));

        actionsTd.appendChild(editBtn);
        actionsTd.appendChild(delBtn);
        tr.appendChild(actionsTd);
        tableBody.appendChild(tr);
    });

    renderDashboard();
}

function filterTable() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    document.querySelectorAll('#tableBody tr').forEach((row) => {
        row.style.display = row.innerText.toLowerCase().includes(query) ? '' : 'none';
    });
}

function openEntryModal(index = -1) {
    editingIndex = index;
    const currentData = appData[activeTab];
    const formFields = document.getElementById('formFields');
    document.getElementById('modalTitle').innerText = index === -1 ? `Tambah Rekod (${activeTab})` : `Edit Rekod (${activeTab})`;

    formFields.innerHTML = '';
    currentData.headers.forEach((h) => {
        if (h === 'No.') return;
        const value = index >= 0 ? currentData.rows[index][h] ?? '' : '';

        const group = document.createElement('div');
        group.className = 'form-group';

        const label = document.createElement('label');
        label.textContent = h;

        const input = document.createElement('input');
        input.type = h === TICKET_HEADER ? 'number' : 'text';
        if (h === TICKET_HEADER) input.min = '1';
        input.id = `field_${h}`;
        input.value = value;
        if (h === 'Nama') input.required = true;

        group.appendChild(label);
        group.appendChild(input);
        formFields.appendChild(group);
    });

    document.getElementById('entryModal').classList.add('active');
}

function closeEntryModal() {
    document.getElementById('entryModal').classList.remove('active');
}

function saveEntry(event) {
    event.preventDefault();
    const currentData = appData[activeTab];
    const rowObject = {};

    currentData.headers.forEach((h) => {
        if (h === 'No.') {
            rowObject[h] = editingIndex >= 0 ? currentData.rows[editingIndex]['No.'] : currentData.rows.length + 1;
        } else {
            const input = document.getElementById(`field_${h}`);
            rowObject[h] = input ? input.value.trim() : '';
        }
    });

    if (editingIndex >= 0) {
        currentData.rows[editingIndex] = rowObject;
    } else {
        currentData.rows.push(rowObject);
    }

    saveAppState();
    closeEntryModal();
    renderTable();
}

function deleteEntry(index) {
    if (!confirm('Padam rekod ini?')) return;
    appData[activeTab].rows.splice(index, 1);
    appData[activeTab].rows.forEach((row, i) => {
        row['No.'] = i + 1;
    });
    saveAppState();
    renderTable();
}

function openTabModal() {
    document.getElementById('tabModal').classList.add('active');
}

function closeTabModal() {
    document.getElementById('tabModal').classList.remove('active');
}

function saveNewTab(event) {
    event.preventDefault();
    const tabName = document.getElementById('newTabName').value.trim();
    if (!tabName) return;
    if (appData[tabName]) {
        alert('Nama tab sudah wujud. Sila cuba nama lain.');
        return;
    }

    appData[tabName] = { headers: ['No.', 'Nama', 'Nombor Telefon', TICKET_HEADER, 'Catatan'], rows: [] };
    document.getElementById('newTabName').value = '';
    closeTabModal();
    switchTab(tabName);
}

function renameTab(tabName, event) {
    event.stopPropagation();
    const newName = prompt('Nama tab baru:', tabName);
    if (newName === null) return;

    const trimmed = newName.trim();
    if (!trimmed || trimmed === tabName) return;
    if (appData[trimmed]) {
        alert('Nama tab sudah wujud. Sila cuba nama lain.');
        return;
    }

    // Rebuild appData with the key renamed in place so tab order in the
    // Firestore doc (and the UI) doesn't shuffle - same document shape,
    // just a different key for this tab.
    const reordered = {};
    Object.keys(appData).forEach((key) => {
        reordered[key === tabName ? trimmed : key] = appData[key];
    });
    appData = reordered;

    if (activeTab === tabName) {
        activeTab = trimmed;
    }

    saveAppState();
    renderTabs();
    renderTable();
}

function deleteTab(tabName, event) {
    event.stopPropagation();
    if (!confirm(`Padam tab "${tabName}"? Semua rekod dalam tab ini akan dipadam.`)) return;

    delete appData[tabName];
    if (activeTab === tabName) {
        activeTab = Object.keys(appData)[0];
    }
    saveAppState();
    renderTabs();
    renderTable();
}

function sheetToRecords(sheet) {
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const headerRowIndex = rawRows.findIndex((row) =>
        row.some((cell) => String(cell).trim().toLowerCase() === 'no.')
    );
    const startIndex = headerRowIndex === -1 ? 0 : headerRowIndex;
    const headers = (rawRows[startIndex] || []).map((cell, i) => normalizeHeader(cell) || `Column${i + 1}`);

    return rawRows.slice(startIndex + 1)
        .filter((row) => row.some((cell) => String(cell).trim() !== ''))
        .map((row) => {
            const record = {};
            headers.forEach((header, i) => {
                record[header] = row[i] ?? '';
            });
            return record;
        });
}

function importDataFromFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    const extension = file.name.split('.').pop()?.toLowerCase();

    reader.onload = async (loadEvent) => {
        try {
            if (extension === 'json') {
                const imported = JSON.parse(loadEvent.target.result);
                mergeImportData(imported);
            } else {
                const workbook = XLSX.read(loadEvent.target.result, { type: 'binary' });
                const imported = {};
                workbook.SheetNames.forEach((sheetName) => {
                    const sheet = workbook.Sheets[sheetName];
                    imported[sheetName] = sheetToRecords(sheet);
                });
                mergeImportData(imported, true);
            }
            if (!activeTab || !appData[activeTab]) {
                activeTab = Object.keys(appData)[0];
            }
            ensureTicketHeaderOnAllTabs();
            saveAppState();
            renderTabs();
            renderTable();
            alert('Import selesai. Semak tab yang baru ditambah atau dikemas kini.');
        } catch (error) {
            console.error(error);
            alert('Gagal import data. Sila semak format fail dan cuba lagi.');
        } finally {
            event.target.value = '';
        }
    };

    if (extension === 'json') {
        reader.readAsText(file);
    } else {
        reader.readAsBinaryString(file);
    }
}

function mergeImportData(imported, isExcel = false) {
    if (!imported || typeof imported !== 'object') {
        throw new Error('Data import tidak sah');
    }

    if (Array.isArray(imported)) {
        mergeTabData(activeTab, imported);
        return;
    }

    const tabKeys = Object.keys(imported);
    if (tabKeys.length === 0) return;

    if (!isExcel && imported.appData && typeof imported.appData === 'object') {
        Object.entries(imported.appData).forEach(([tabName, tabValue]) => {
            if (tabValue?.headers && Array.isArray(tabValue.rows)) {
                appData[tabName] = tabValue;
            }
        });
        return;
    }

    const hasSheetLike = tabKeys.every((key) => Array.isArray(imported[key]));
    if (hasSheetLike) {
        tabKeys.forEach((tabName) => {
            mergeTabData(tabName, imported[tabName]);
        });
        return;
    }

    if (imported.headers && Array.isArray(imported.rows)) {
        appData[activeTab] = imported;
        return;
    }

    mergeTabData(activeTab, Array.isArray(imported) ? imported : [imported]);
}

function normalizeRowKeys(row) {
    const normalized = {};
    Object.entries(row).forEach(([key, value]) => {
        normalized[normalizeHeader(key)] = value;
    });
    return normalized;
}

function mergeTabData(tabName, rows) {
    const normalizedRows = rows.map(normalizeRowKeys);

    if (!appData[tabName]) {
        const sampleHeaders = normalizedRows.length ? Object.keys(normalizedRows[0]) : ['No.', 'Nama', 'Nombor Telefon'];
        appData[tabName] = { headers: ['No.', ...sampleHeaders.filter((h) => h !== 'No.')], rows: [] };
    }

    const destination = appData[tabName];
    const headers = destination.headers;

    normalizedRows.forEach((row) => {
        const record = { 'No.': destination.rows.length + 1 };
        headers.forEach((header) => {
            if (header === 'No.') return;
            record[header] = row[header] ?? '';
        });
        destination.rows.push(record);
    });
}

async function exportAllToExcel() {
    // The free build of the xlsx (SheetJS) library used for import/CSV
    // can't write cell styling, so colored headers need ExcelJS instead.
    const workbook = new ExcelJS.Workbook();

    Object.entries(appData).forEach(([tabName, sheetData]) => {
        const worksheet = workbook.addWorksheet(tabName.substring(0, 31));

        const headerRow = worksheet.addRow(sheetData.headers);
        headerRow.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        });

        sheetData.rows.forEach((row) => {
            worksheet.addRow(sheetData.headers.map((h) => row[h] ?? ''));
        });

        sheetData.headers.forEach((h, i) => {
            worksheet.getColumn(i + 1).width = Math.max(12, h.length + 2);
        });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'Konsert_Shila_Amzah_Kemaskini.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

function exportCurrentTabCSV() {
    const sheetData = appData[activeTab];
    const rows = sheetData.rows.map((row) => {
        const rowObj = {};
        sheetData.headers.forEach((h) => {
            rowObj[h] = row[h];
        });
        return rowObj;
    });
    const ws = XLSX.utils.json_to_sheet(rows, { header: sheetData.headers });
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `${activeTab}_data.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function updateSyncStatus(message = 'Menunggu status...') {
    const statusEl = document.getElementById('syncStatus');
    if (statusEl) {
        statusEl.textContent = message;
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    initFirebase();
    await loadData();
    ensureTicketHeaderOnAllTabs();
    renderTabs();
    renderTable();
    updateSyncStatus('Sedia');
});
