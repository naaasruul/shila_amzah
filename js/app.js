const DEFAULT_APP_DATA = {};

const FIRESTORE_DOC_PATH = 'app/state';
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
        btn.innerText = tabName;
        btn.addEventListener('click', () => switchTab(tabName));
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

    let headerHTML = '<tr>';
    currentData.headers.forEach((h) => {
        headerHTML += `<th>${h}</th>`;
    });
    headerHTML += '<th>Tindakan</th></tr>';
    tableHead.innerHTML = headerHTML;

    tableBody.innerHTML = '';
    currentData.rows.forEach((row, idx) => {
        let rowHTML = '<tr>';
        currentData.headers.forEach((h) => {
            rowHTML += `<td>${row[h] ?? '-'}</td>`;
        });
        rowHTML += `
            <td class="action-btns">
                <button class="btn btn-sm btn-secondary" type="button" onclick="openEntryModal(${idx})">Edit</button>
                <button class="btn btn-sm btn-danger" type="button" onclick="deleteEntry(${idx})">Padam</button>
            </td>`;
        rowHTML += '</tr>';
        tableBody.innerHTML += rowHTML;
    });
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
        formFields.innerHTML += `
            <div class="form-group">
                <label>${h}</label>
                <input type="text" id="field_${h}" value="${value}" ${h === 'Nama' ? 'required' : ''}>
            </div>`;
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

    appData[tabName] = { headers: ['No.', 'Nama', 'Nombor Telefon', 'Catatan'], rows: [] };
    document.getElementById('newTabName').value = '';
    closeTabModal();
    switchTab(tabName);
}

function sheetToRecords(sheet) {
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const headerRowIndex = rawRows.findIndex((row) =>
        row.some((cell) => String(cell).trim().toLowerCase() === 'no.')
    );
    const startIndex = headerRowIndex === -1 ? 0 : headerRowIndex;
    const headers = (rawRows[startIndex] || []).map((cell, i) => String(cell).trim() || `Column${i + 1}`);

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

function mergeTabData(tabName, rows) {
    if (!appData[tabName]) {
        const sampleHeaders = rows.length ? Object.keys(rows[0]) : ['No.', 'Nama', 'Nombor Telefon'];
        appData[tabName] = { headers: ['No.', ...sampleHeaders.filter((h) => h !== 'No.')], rows: [] };
    }

    const destination = appData[tabName];
    const headers = destination.headers;

    rows.forEach((row) => {
        const record = { 'No.': destination.rows.length + 1 };
        headers.forEach((header) => {
            if (header === 'No.') return;
            record[header] = row[header] ?? row[header.replace(/\s+/g, ' ')] ?? '';
        });
        destination.rows.push(record);
    });
}

function exportAllToExcel() {
    const wb = XLSX.utils.book_new();
    Object.entries(appData).forEach(([tabName, sheetData]) => {
        const rows = sheetData.rows.map((row) => {
            const rowObj = {};
            sheetData.headers.forEach((h) => {
                rowObj[h] = row[h];
            });
            return rowObj;
        });
        const ws = XLSX.utils.json_to_sheet(rows, { header: sheetData.headers });
        XLSX.utils.book_append_sheet(wb, ws, tabName.substring(0, 31));
    });
    XLSX.writeFile(wb, 'Konsert_Shila_Amzah_Kemaskini.xlsx');
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
    renderTabs();
    renderTable();
    updateSyncStatus('Sedia');
});
