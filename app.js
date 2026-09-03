// DuetBudget - Couple's Budgeting Application Logic

// --- SUPABASE SYNCRONIZATION VARIABLES ---
let supabaseClient = null;
let supabaseChannel = null;
let isLocalSaveOnly = false;

// --- STATE MANAGEMENT ---
let state = {
    config: {
        member1: "Cris",
        member2: "Flor",
        currency: "$",
        splitMode: "proportional" // "proportional" or "equal"
    },
    currentMonth: "2026-06",
    months: {} // Key: "YYYY-MM", Value: { income: [], fixedExpenses: [], varExpenses: [], savings: [] }
};

// Seed Data for initial load
const SEED_MONTH = "2026-06";
const SEED_DATA = {
    income: [],
    fixedExpenses: [],
    varExpenses: [],
    savings: []
};

// --- CHART INSTANCES ---
let categoryChart = null;
let comparisonChart = null;

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
    loadStateFromLocalStorage();
    initializeMonthSelector();
    setupEventListeners();
    switchTab("dashboard");
    renderApp();
    loadSupabaseConfig(); // Intentar cargar y conectar la base de datos Supabase
});

// Load state from LocalStorage or seed if empty
function loadStateFromLocalStorage() {
    const savedState = localStorage.getItem("duetbudget_state_clean");
    if (savedState) {
        try {
            state = JSON.parse(savedState);
            // Ensure config and data structures are robustly initialized
            if (!state.config) {
                state.config = {
                    member1: "Cris",
                    member2: "Flor",
                    currency: "$",
                    splitMode: "proportional"
                };
            }
            if (!state.months || typeof state.months !== 'object') {
                state.months = {};
            }
            if (!state.currentMonth || typeof state.currentMonth !== 'string') {
                state.currentMonth = SEED_MONTH;
            }
            if (!Array.isArray(state.savedBudgets) || state.savedBudgets.length === 0) {
                state.savedBudgets = [
                    { id: 'sb_october', name: '📅 Presupuesto Octubre', createdAt: new Date().toISOString(), items: [] },
                    { id: 'sb_house', name: '🏠 Presupuesto Compra Casa', createdAt: new Date().toISOString(), items: [] },
                    { id: 'sb_car', name: '🚗 Presupuesto Cambio Auto', createdAt: new Date().toISOString(), items: [] }
                ];
            }
            if (!state.activeBudgetId) {
                state.activeBudgetId = state.savedBudgets[0].id;
            }
        } catch (e) {
            console.error("Error loading saved state. Using default/seed data.", e);
            seedState();
        }
    } else {
        seedState();
    }
}

// Seed the state with default values
function seedState() {
    state.config = {
        member1: "Cris",
        member2: "Flor",
        currency: "$",
        splitMode: "proportional"
    };
    state.currentMonth = SEED_MONTH;
    state.months = {};
    state.savedBudgets = [
        { id: 'sb_october', name: '📅 Presupuesto Octubre', createdAt: new Date().toISOString(), items: [] },
        { id: 'sb_house', name: '🏠 Presupuesto Compra Casa', createdAt: new Date().toISOString(), items: [] },
        { id: 'sb_car', name: '🚗 Presupuesto Cambio Auto', createdAt: new Date().toISOString(), items: [] }
    ];
    state.activeBudgetId = 'sb_october';
    state.months[SEED_MONTH] = JSON.parse(JSON.stringify(SEED_DATA));
    saveState();
}

function saveState() {
    localStorage.setItem("duetbudget_state_clean", JSON.stringify(state));
    
    // Si Supabase está configurado y no es un guardado local provocado por actualización remota
    if (supabaseClient && !isLocalSaveOnly) {
        supabaseClient
            .from('duet_budget')
            .update({ data: state, updated_at: new Date().toISOString() })
            .eq('id', 'default')
            .then(({ error }) => {
                if (error) {
                    console.error("Error al actualizar Supabase:", error);
                    updateSupabaseStatusBadge("error", "Error al guardar");
                    showToast("Error de sincronización con la nube.", "error");
                } else {
                    updateSupabaseStatusBadge("connected", "Sincronizado");
                }
            });
    }
}

// Ensure the specified month exists in the database
function ensureMonthExists(monthKey) {
    if (!state.months[monthKey]) {
        state.months[monthKey] = {
            income: [],
            fixedExpenses: [],
            varExpenses: [],
            savings: []
        };
        // Clone savings goals from previous month if available, so they don't have to re-enter targets
        const monthsList = Object.keys(state.months).sort();
        const currentIndex = monthsList.indexOf(monthKey);
        if (currentIndex > 0) {
            const prevMonthKey = monthsList[currentIndex - 1];
            const prevMonthData = state.months[prevMonthKey];
            if (prevMonthData && prevMonthData.savings) {
                // Copy goals
                state.months[monthKey].savings = JSON.parse(JSON.stringify(prevMonthData.savings));
            }
        }
        initializeMonthSelector();
        saveState();
    }
}

// Ensure the current month exists in the database
function ensureCurrentMonthExists() {
    ensureMonthExists(state.currentMonth);
}

// Populate months dropdown (relative to current and seeded months)
function initializeMonthSelector() {
    const selector = document.getElementById("month-selector");
    selector.innerHTML = "";
    
    // Generate months list
    const monthKeys = new Set(Object.keys(state.months));
    // Always include a few recent months and the current month
    const now = new Date();
    for (let i = -5; i <= 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthKeys.add(key);
    }
    
    const sortedMonths = Array.from(monthKeys).sort().reverse();
    sortedMonths.forEach(mKey => {
        const [year, month] = mKey.split("-");
        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        const option = document.createElement("option");
        option.value = mKey;
        option.textContent = `${monthNames[parseInt(month) - 1]} ${year}`;
        if (mKey === state.currentMonth) {
            option.selected = true;
        }
        selector.appendChild(option);
    });
}

// --- NAVIGATION & TABS ---
function switchTab(tabId) {
    // Update active nav link style
    document.querySelectorAll(".nav-item").forEach(item => {
        if (item.getAttribute("data-tab") === tabId) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });

    // Update active tab panel visibility
    document.querySelectorAll(".tab-content").forEach(panel => {
        if (panel.id === `tab-${tabId}`) {
            panel.classList.add("active");
        } else {
            panel.classList.remove("active");
        }
    });

    // Update Title in the top bar
    const titleEl = document.getElementById("page-display-title");
    const descEl = document.getElementById("page-display-desc");
    
    switch (tabId) {
        case "dashboard":
            titleEl.textContent = "Dashboard";
            descEl.textContent = "Resumen financiero general del hogar.";
            break;
        case "income":
            titleEl.textContent = "Ingresos";
            descEl.textContent = "Control de sueldos y aportes individuales o pasivos.";
            break;
        case "expenses-fixed":
            titleEl.textContent = "Egresos Fijos";
            descEl.textContent = "Gastos mensuales estables u obligatorios.";
            break;
        case "expenses-var":
            titleEl.textContent = "Egresos Variables";
            descEl.textContent = "Gastos cotidianos clasificados por categorías.";
            break;
        case "savings":
            titleEl.textContent = "Ahorros";
            descEl.textContent = "Fondo de emergencia, objetivos personales o comunes de ahorro.";
            break;
        case "investments":
            titleEl.textContent = "Inversiones";
            descEl.textContent = "Monitoreo del portafolio de inversión, CEDEARs, acciones o criptomonedas.";
            break;
        case "upcoming":
            titleEl.textContent = "Próximos Gastos";
            descEl.textContent = "Planificador de compromisos y compras futuras.";
            break;
        case "analysis":
            titleEl.textContent = "Análisis por Período";
            descEl.textContent = "Informe histórico acumulado y consumo entre fechas.";
            break;
        case "settings":
            titleEl.textContent = "Configuración";
            descEl.textContent = "Preferencias, división de cuentas y administración de datos.";
            break;
    }

    // Trigger recalculation and rendering to ensure dashboard is always up to date
    if (tabId === "dashboard") {
        renderApp();
        setTimeout(renderCharts, 50);
    } else if (tabId === "upcoming") {
        renderUpcomingExpenses();
    } else if (tabId === "analysis") {
        renderPeriodAnalysis();
    }
}

// --- RENDER FUNCTIONS ---
function renderApp() {
    ensureCurrentMonthExists();
    setDefaultDates();
    
    // Update config displays
    updateConfigUI();
    
    // Render Month tables & totals
    const currentData = state.months[state.currentMonth];
    
    renderIncome(currentData.income);
    renderFixedExpenses(currentData.fixedExpenses);
    renderVarExpenses(currentData.varExpenses);
    renderSavings(currentData.savings);
    renderUpcomingExpenses();
    
    // Calculate final metrics and settlement
    calculateBudgetMetrics();
}

// Helper to format currency
function formatVal(amount) {
    return `${state.config.currency}${Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Helper to format custom currency (symbol vs text prefix/suffix)
function formatCurrencyCustom(amount, symbol) {
    const formattedAmount = Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const standardSymbols = ["$", "€", "£", "¥"];
    const sym = symbol || "$";
    if (standardSymbols.includes(sym)) {
        return `${sym}${formattedAmount}`;
    } else {
        return `${formattedAmount} ${sym}`;
    }
}

// Helper to format date display in tables (YYYY-MM-DD to DD/MM/YYYY)
function formatDateDisplay(dateStr) {
    if (!dateStr) return "-";
    try {
        const [year, month, day] = dateStr.split("-");
        if (!year || !month || !day) return dateStr;
        return `${day}/${month}/${year}`;
    } catch (e) {
        return dateStr;
    }
}

// Set default dates for the forms based on active month
function setDefaultDates() {
    const now = new Date();
    const actualMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    let defaultDateVal = "";
    if (state.currentMonth === actualMonthKey) {
        defaultDateVal = now.toISOString().substring(0, 10);
    } else {
        defaultDateVal = `${state.currentMonth}-01`;
    }
    
    const incomeDateInput = document.getElementById("income-date");
    const fixedDateInput = document.getElementById("fixed-date");
    const varDateInput = document.getElementById("var-date");
    
    if (incomeDateInput) incomeDateInput.value = defaultDateVal;
    if (fixedDateInput) fixedDateInput.value = defaultDateVal;
    if (varDateInput) varDateInput.value = defaultDateVal;
}

// Update settings UI values from state
function updateConfigUI() {
    document.getElementById("config-name-1").value = state.config.member1;
    document.getElementById("config-name-2").value = state.config.member2;
    document.getElementById("config-currency").value = state.config.currency;
    document.getElementById("config-split-mode").value = state.config.splitMode;
    
    // Update profile displays in sidebar
    document.getElementById("summary-avatar-1").textContent = state.config.member1.charAt(0).toUpperCase();
    document.getElementById("summary-avatar-2").textContent = state.config.member2.charAt(0).toUpperCase();
    document.getElementById("summary-names").textContent = `${state.config.member1} & ${state.config.member2}`;
    
    // Update member option values in selector forms
    const selectors = [
        { id: "income-owner", includeShared: true },
        { id: "fixed-payer", includeShared: false },
        { id: "fixed-split", includeShared: true, customLabel: "Dividido (Común)" },
        { id: "var-payer", includeShared: false },
        { id: "var-split", includeShared: true, customLabel: "Dividido (Común)" }
    ];
    
    selectors.forEach(sel => {
        const el = document.getElementById(sel.id);
        if (!el) return;
        const currentVal = el.value;
        el.innerHTML = "";
        
        // Option 1
        const opt1 = document.createElement("option");
        opt1.value = "member1";
        opt1.textContent = sel.id.includes("payer") ? `Pagó ${state.config.member1}` : (sel.id.includes("split") ? `Solo ${state.config.member1}` : state.config.member1);
        el.appendChild(opt1);
        
        // Option 2
        const opt2 = document.createElement("option");
        opt2.value = "member2";
        opt2.textContent = sel.id.includes("payer") ? `Pagó ${state.config.member2}` : (sel.id.includes("split") ? `Solo ${state.config.member2}` : state.config.member2);
        el.appendChild(opt2);
        
        // Shared Option
        if (sel.includeShared) {
            const optS = document.createElement("option");
            optS.value = "shared";
            optS.textContent = sel.customLabel || "Común (Pasivos/Ventas)";
            el.appendChild(optS);
        }
        
        el.value = currentVal || el.options[0].value;
    });
}

// --- SORTING, FILTERING & DUPLICATE DETECTION HELPERS ---
let sortOrders = {
    income: 'asc',
    fixedExpenses: 'asc',
    varExpenses: 'asc'
};

function toggleSortOrder(type) {
    sortOrders[type] = sortOrders[type] === 'asc' ? 'desc' : 'asc';
    const icon = document.getElementById(`sort-icon-${type}`);
    if (icon) {
        icon.textContent = sortOrders[type] === 'asc' ? '▲' : '▼';
    }
    renderApp();
}

function sortItemsByDate(items, order = 'asc') {
    if (!items || !Array.isArray(items)) return [];
    return [...items].sort((a, b) => {
        const dateA = a.date || `${state.currentMonth}-01`;
        const dateB = b.date || `${state.currentMonth}-01`;
        const comp = dateA.localeCompare(dateB);
        return order === 'asc' ? comp : -comp;
    });
}

function findDuplicateIds(list) {
    if (!list || !Array.isArray(list)) return new Set();
    const counts = {};
    list.forEach(item => {
        const normDesc = (item.desc || '').trim().toLowerCase();
        const key = `${normDesc}::${Number(item.amount)}`;
        counts[key] = (counts[key] || 0) + 1;
    });
    
    const duplicateIds = new Set();
    list.forEach(item => {
        const normDesc = (item.desc || '').trim().toLowerCase();
        const key = `${normDesc}::${Number(item.amount)}`;
        if (counts[key] > 1) {
            duplicateIds.add(item.id);
        }
    });
    return duplicateIds;
}

function filterListBySearch(list, query, type) {
    if (!query || !query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter(item => {
        const desc = (item.desc || '').toLowerCase();
        const amountStr = String(item.amount || '');
        const dateStr = formatDateDisplay(item.date || `${state.currentMonth}-01`).toLowerCase();
        
        let memberText = '';
        if (type === 'income') {
            memberText = item.owner === 'member1' ? state.config.member1 : (item.owner === 'member2' ? state.config.member2 : 'común');
        } else {
            const payerText = item.payer === 'member1' ? state.config.member1 : state.config.member2;
            const splitText = item.split === 'shared' ? 'común' : (item.split === 'member1' ? state.config.member1 : state.config.member2);
            memberText = `${payerText} ${splitText}`;
        }
        const cat = (item.category || '').toLowerCase();
        
        return desc.includes(q) || amountStr.includes(q) || dateStr.includes(q) || memberText.toLowerCase().includes(q) || cat.includes(q);
    });
}

// Render Income Tab Table
function renderIncome(incomeList) {
    const tbody = document.getElementById("table-income-body");
    tbody.innerHTML = "";
    
    const sortedList = sortItemsByDate(incomeList || [], sortOrders.income);
    const dupSet = findDuplicateIds(sortedList);
    const searchVal = document.getElementById("search-income")?.value || "";
    const filteredList = filterListBySearch(sortedList, searchVal, "income");
    
    const countBadge = document.getElementById("search-count-income");
    if (countBadge) {
        countBadge.textContent = searchVal.trim() ? `${filteredList.length} de ${incomeList.length}` : `${incomeList.length} registros`;
    }

    if (filteredList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">${searchVal.trim() ? 'No se encontraron ingresos con ese filtro.' : 'No hay ingresos registrados para este mes.'}</td></tr>`;
        return;
    }
    
    filteredList.forEach(inc => {
        const tr = document.createElement("tr");
        
        let ownerLabel = "";
        if (inc.owner === "member1") ownerLabel = `<span class="badge badge-cris">${state.config.member1}</span>`;
        else if (inc.owner === "member2") ownerLabel = `<span class="badge badge-flor">${state.config.member2}</span>`;
        else ownerLabel = `<span class="badge badge-shared">Compartido</span>`;
        
        const displayDate = formatDateDisplay(inc.date || `${state.currentMonth}-01`);
        const isDuplicate = dupSet.has(inc.id);
        const dupBadge = isDuplicate ? `<span class="badge-duplicate" title="Hay otro ingreso con la misma descripción y monto en este mes">⚠️ Posible duplicado</span>` : '';
        
        tr.innerHTML = `
            <td>${displayDate}</td>
            <td>${inc.desc} ${dupBadge}</td>
            <td>${ownerLabel}</td>
            <td style="text-align: right; font-weight:700;">${formatVal(inc.amount)}</td>
            <td style="text-align: center;">
                <button class="btn btn-secondary" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; margin-right: 0.25rem;" onclick="openEditItemModal('income', '${inc.id}')">
                    Editar
                </button>
                <button class="btn btn-danger" style="padding: 0.35rem 0.65rem; font-size: 0.75rem;" onclick="deleteItem('income', '${inc.id}')">
                    Borrar
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Render Fixed Expenses Tab Table
function renderFixedExpenses(fixedList) {
    const tbody = document.getElementById("table-fixed-body");
    tbody.innerHTML = "";
    
    const sortedList = sortItemsByDate(fixedList || [], sortOrders.fixedExpenses);
    const dupSet = findDuplicateIds(sortedList);
    const searchVal = document.getElementById("search-fixed")?.value || "";
    const filteredList = filterListBySearch(sortedList, searchVal, "fixedExpenses");
    
    const countBadge = document.getElementById("search-count-fixed");
    if (countBadge) {
        countBadge.textContent = searchVal.trim() ? `${filteredList.length} de ${fixedList.length}` : `${fixedList.length} registros`;
    }

    if (filteredList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">${searchVal.trim() ? 'No se encontraron egresos fijos con ese filtro.' : 'No hay egresos fijos registrados.'}</td></tr>`;
        return;
    }
    
    filteredList.forEach(exp => {
        const tr = document.createElement("tr");
        
        let payerLabel = exp.payer === "member1" ? `<span class="badge badge-cris">${state.config.member1}</span>` : `<span class="badge badge-flor">${state.config.member2}</span>`;
        
        let splitLabel = "";
        if (exp.split === "shared") splitLabel = `<span class="badge badge-shared">Común</span>`;
        else if (exp.split === "member1") splitLabel = `<span class="badge badge-cris">Solo ${state.config.member1}</span>`;
        else splitLabel = `<span class="badge badge-flor">Solo ${state.config.member2}</span>`;
        
        const displayDate = formatDateDisplay(exp.date || `${state.currentMonth}-01`);
        const isDuplicate = dupSet.has(exp.id);
        const dupBadge = isDuplicate ? `<span class="badge-duplicate" title="Hay otro egreso con la misma descripción y monto en este mes">⚠️ Posible duplicado</span>` : '';
        
        tr.innerHTML = `
            <td>${displayDate}</td>
            <td>${exp.desc} ${dupBadge}</td>
            <td>${payerLabel}</td>
            <td>${splitLabel}</td>
            <td style="text-align: right; font-weight:700; color:var(--color-danger);">${formatVal(exp.amount)}</td>
            <td style="text-align: center;">
                <button class="btn btn-secondary" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; margin-right: 0.25rem;" onclick="openEditItemModal('fixedExpenses', '${exp.id}')">
                    Editar
                </button>
                <button class="btn btn-danger" style="padding: 0.35rem 0.65rem; font-size: 0.75rem;" onclick="deleteItem('fixedExpenses', '${exp.id}')">
                    Borrar
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Helper for flexible category matching (robust against accents, casing, slashes)
function matchesCategory(itemCategory, filterCategory) {
    if (!filterCategory) return true;
    if (!itemCategory) return false;
    if (itemCategory === filterCategory) return true;
    const norm = (str) => String(str).toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\/\s&y]/g, "");
    const c1 = norm(itemCategory);
    const c2 = norm(filterCategory);
    return c1.includes(c2) || c2.includes(c1);
}

// Populate and update category filter select options with item counts
function updateCategoryFilterOptions(varList) {
    const select = document.getElementById("filter-category-var");
    if (!select) return;
    const currentVal = select.value;
    
    const categoriesSet = new Set();
    const standardCategories = ["Alimentación", "Salidas y Ocio", "Transporte", "Salud y Cuidado", "Suscripciones", "Hogar", "Otros"];
    standardCategories.forEach(c => categoriesSet.add(c));
    
    (varList || []).forEach(item => {
        if (item.category && item.category.trim()) {
            categoriesSet.add(item.category.trim());
        }
    });
    
    let html = `<option value="">Todas las categorías (${varList ? varList.length : 0})</option>`;
    categoriesSet.forEach(cat => {
        const count = (varList || []).filter(item => matchesCategory(item.category, cat)).length;
        if (count > 0 || standardCategories.includes(cat)) {
            html += `<option value="${cat}">${cat} (${count})</option>`;
        }
    });
    
    select.innerHTML = html;
    select.value = currentVal;
}

window.filterByCategory = function(catName) {
    const select = document.getElementById("filter-category-var");
    if (select) {
        select.value = catName;
        renderApp();
    }
};

// Render Variable Expenses Tab Table
function renderVarExpenses(varList) {
    const tbody = document.getElementById("table-var-body");
    tbody.innerHTML = "";
    
    const sortedList = sortItemsByDate(varList || [], sortOrders.varExpenses);
    const dupSet = findDuplicateIds(sortedList);
    const catFilter = document.getElementById("filter-category-var")?.value || "";
    
    let baseList = sortedList;
    if (catFilter) {
        baseList = baseList.filter(item => matchesCategory(item.category, catFilter));
    }
    
    const searchVal = document.getElementById("search-var")?.value || "";
    const filteredList = filterListBySearch(baseList, searchVal, "varExpenses");
    
    const countBadge = document.getElementById("search-count-var");
    if (countBadge) {
        const isFiltering = Boolean(searchVal.trim() || catFilter);
        countBadge.textContent = isFiltering ? `${filteredList.length} de ${varList.length}` : `${varList.length} registros`;
    }

    if (filteredList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">${(searchVal.trim() || catFilter) ? 'No se encontraron egresos variables con ese filtro.' : 'No hay egresos variables registrados.'}</td></tr>`;
        return;
    }
    
    filteredList.forEach(exp => {
        const tr = document.createElement("tr");
        
        let payerLabel = exp.payer === "member1" ? `<span class="badge badge-cris">${state.config.member1}</span>` : `<span class="badge badge-flor">${state.config.member2}</span>`;
        
        let splitLabel = "";
        if (exp.split === "shared") splitLabel = `<span class="badge badge-shared">Común</span>`;
        else if (exp.split === "member1") splitLabel = `<span class="badge badge-cris">Solo ${state.config.member1}</span>`;
        else splitLabel = `<span class="badge badge-flor">Solo ${state.config.member2}</span>`;
        
        const displayDate = formatDateDisplay(exp.date || `${state.currentMonth}-01`);
        const isDuplicate = dupSet.has(exp.id);
        const dupBadge = isDuplicate ? `<span class="badge-duplicate" title="Hay otro egreso con la misma descripción y monto en este mes">⚠️ Posible duplicado</span>` : '';
        
        tr.innerHTML = `
            <td>${displayDate}</td>
            <td>${exp.desc} ${dupBadge}</td>
            <td><span class="badge category-badge-clickable" style="background:rgba(255,255,255,0.06); color:var(--text-secondary); border:1px solid rgba(255,255,255,0.1);" onclick="filterByCategory('${exp.category}')" title="Haz clic para filtrar por la categoría ${exp.category}">${exp.category}</span></td>
            <td>${payerLabel}</td>
            <td>${splitLabel}</td>
            <td style="text-align: right; font-weight:700; color:var(--color-danger);">${formatVal(exp.amount)}</td>
            <td style="text-align: center;">
                <button class="btn btn-secondary" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; margin-right: 0.25rem;" onclick="openEditItemModal('varExpenses', '${exp.id}')">
                    Editar
                </button>
                <button class="btn btn-danger" style="padding: 0.35rem 0.65rem; font-size: 0.75rem;" onclick="deleteItem('varExpenses', '${exp.id}')">
                    Borrar
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Render Savings and Investments Tab Grids
function renderSavings(savingsList) {
    const savingsGrid = document.getElementById("savings-goals-grid");
    const investmentsGrid = document.getElementById("investments-goals-grid");
    
    if (!savingsGrid || !investmentsGrid) return;
    
    const savingsItems = (savingsList || []).filter(item => item.category === "Ahorro");
    const investmentItems = (savingsList || []).filter(item => item.category === "Inversión");
    
    renderGoalGrid(savingsGrid, savingsItems, "Ahorro");
    renderGoalGrid(investmentsGrid, investmentItems, "Inversión");
}

function renderGoalGrid(container, items, type) {
    container.innerHTML = "";
    
    if (items.length === 0) {
        container.innerHTML = `<div class="glass-card" style="text-align:center; color:var(--text-muted); grid-column: 1/-1;">No hay ${type.toLowerCase()}s registrados para este mes.</div>`;
        return;
    }
    
    container.style.display = "grid";
    container.style.gridTemplateColumns = "repeat(auto-fill, minmax(300px, 1fr))";
    container.style.gap = "1.5rem";
    
    items.forEach(goal => {
        const card = document.createElement("div");
        card.className = "glass-card savings-goal-card";
        
        const percent = goal.target > 0 ? Math.min(Math.round((goal.saved / goal.target) * 100), 100) : 0;
        const goalCurrency = goal.currency || "€";
        
        card.innerHTML = `
            <div class="goal-info">
                <div>
                    <span class="badge badge-shared" style="margin-bottom:0.5rem;">${goal.category}</span>
                    <div class="goal-title">${goal.desc}</div>
                </div>
                <div class="goal-numbers">
                    <strong>${percent}%</strong>
                    <div style="color:var(--text-muted); font-size:0.75rem; margin-top:0.25rem;">
                        ${formatCurrencyCustom(goal.saved, goalCurrency)} / ${formatCurrencyCustom(goal.target, goalCurrency)}
                    </div>
                </div>
            </div>
            
            <div class="progress-container">
                <div class="progress-bar" style="width: ${percent}%;"></div>
            </div>
            
            <div class="goal-controls-wrapper">
                <!-- Quick transaction adjustment group -->
                <div class="goal-transaction-group">
                    <input type="number" class="goal-adjust-input" id="input-adjust-${goal.id}" placeholder="0.00" min="0" step="any">
                    <button class="btn-adjust-qty plus" onclick="adjustSavingsManual('${goal.id}', true)">+</button>
                    <button class="btn-adjust-qty minus" onclick="adjustSavingsManual('${goal.id}', false)">-</button>
                </div>
                <!-- Management group -->
                <div class="goal-management-group">
                    <button class="btn btn-secondary btn-mini" onclick="openEditGoalModal('${goal.id}')">Editar</button>
                    <button class="btn btn-danger btn-mini" onclick="deleteItem('savings', '${goal.id}')">Borrar</button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// Global window actions for delete and adjustments
window.deleteItem = function(listType, id) {
    const list = state.months[state.currentMonth][listType];
    const index = list.findIndex(item => item.id === id);
    if (index !== -1) {
        list.splice(index, 1);
        saveState();
        renderApp();
    }
};

window.adjustSavingsManual = function(goalId, isAddition) {
    const inputEl = document.getElementById(`input-adjust-${goalId}`);
    if (!inputEl) return;
    const adjustVal = Number(inputEl.value);
    if (isNaN(adjustVal) || adjustVal <= 0) {
        alert("Por favor, ingresa un monto válido mayor a 0.");
        return;
    }
    
    const list = state.months[state.currentMonth].savings;
    const goal = list.find(item => item.id === goalId);
    if (goal) {
        if (isAddition) {
            goal.saved = Number((goal.saved + adjustVal).toFixed(8));
        } else {
            goal.saved = Number(Math.max(0, goal.saved - adjustVal).toFixed(8));
        }
        saveState();
        renderApp();
    }
};

window.openEditGoalModal = function(goalId) {
    const list = state.months[state.currentMonth].savings;
    const goal = list.find(item => item.id === goalId);
    if (!goal) return;
    
    document.getElementById("edit-goal-id").value = goal.id;
    document.getElementById("edit-goal-desc").value = goal.desc;
    document.getElementById("edit-goal-category").value = goal.category;
    document.getElementById("edit-goal-currency").value = goal.currency || "€";
    document.getElementById("edit-goal-saved").value = goal.saved;
    document.getElementById("edit-goal-target").value = goal.target;
    
    document.getElementById("edit-modal").classList.add("active");
};

window.closeEditGoalModal = function() {
    document.getElementById("edit-modal").classList.remove("active");
};

// --- CALCULATIONS & MATH ---
function calculateBudgetMetrics() {
    const currentData = state.months[state.currentMonth] || { income: [], fixedExpenses: [], varExpenses: [], savings: [] };
    
    const incomeList = currentData.income || [];
    const fixedList = currentData.fixedExpenses || [];
    const varList = currentData.varExpenses || [];
    const savingsList = currentData.savings || [];
    
    // 1. Sum Incomes
    let incomeMember1 = 0;
    let incomeMember2 = 0;
    let incomeShared = 0;
    
    incomeList.forEach(inc => {
        const amt = Number(inc.amount) || 0;
        if (inc.owner === "member1") incomeMember1 += amt;
        else if (inc.owner === "member2") incomeMember2 += amt;
        else incomeShared += amt;
    });
    
    const totalIncome = incomeMember1 + incomeMember2 + incomeShared;
    
    // 2. Sum Expenses
    let totalFixed = 0;
    let totalVar = 0;
    
    fixedList.forEach(exp => totalFixed += (Number(exp.amount) || 0));
    varList.forEach(exp => totalVar += (Number(exp.amount) || 0));
    
    const totalExpenses = totalFixed + totalVar;
    
    // 3. Group Savings and Investments progress/total target by currency
    const savingsByCurrency = {};
    const investmentsByCurrency = {};
    
    savingsList.forEach(sav => {
        const curr = sav.currency || "€";
        const isInvestment = sav.category === "Inversión";
        const group = isInvestment ? investmentsByCurrency : savingsByCurrency;
        
        if (!group[curr]) {
            group[curr] = { saved: 0, target: 0 };
        }
        group[curr].saved += (Number(sav.saved) || 0);
        group[curr].target += (Number(sav.target) || 0);
    });
    
    // 4. Calculate Net Balance
    const netBalance = totalIncome - totalExpenses;
    
    // Update summary UI card elements
    document.getElementById("card-total-income").textContent = formatVal(totalIncome);
    document.getElementById("card-income-split").textContent = `${state.config.member1}: ${formatVal(incomeMember1)} | ${state.config.member2}: ${formatVal(incomeMember2)}`;
    
    document.getElementById("card-total-expenses").textContent = formatVal(totalExpenses);
    document.getElementById("card-expenses-split").textContent = `Fijos: ${formatVal(totalFixed)} | Variables: ${formatVal(totalVar)}`;
    
    // Render savings card value and subtext with premium breakdown
    const savingsCount = savingsList.filter(s => s.category === "Ahorro").length;
    document.getElementById("card-total-savings").innerHTML = renderCurrencyBreakdown(savingsByCurrency, false);
    document.getElementById("card-savings-rate").innerHTML = `${savingsCount} objetivo${savingsCount !== 1 ? 's' : ''} de ahorro`;
    
    // Render investments card value and subtext with premium breakdown
    const investmentsCount = savingsList.filter(s => s.category === "Inversión").length;
    document.getElementById("card-total-investments").innerHTML = renderCurrencyBreakdown(investmentsByCurrency, true);
    document.getElementById("card-investments-rate").innerHTML = `${investmentsCount} activo${investmentsCount !== 1 ? 's' : ''} en cartera`;
    
    document.getElementById("card-total-balance").textContent = formatVal(netBalance);
    document.getElementById("card-balance-rate").textContent = `${totalIncome > 0 ? Math.round((netBalance / totalIncome) * 100) : 0}% de los ingresos libres`;
    
    // --- LEDGER / SETTLEMENT CALCULATIONS ---
    // Establish split ratio
    let ratio1 = 0.5;
    let ratio2 = 0.5;
    
    if (state.config.splitMode === "proportional") {
        const individualTotal = incomeMember1 + incomeMember2;
        if (individualTotal > 0) {
            ratio1 = incomeMember1 / individualTotal;
            ratio2 = incomeMember2 / individualTotal;
        }
    }
    
    // Update UI displays for proportions
    const splitMode = state.config.splitMode;
    let splitText = "Proporcional";
    if (splitMode === "equal") splitText = "Equitativo (50/50)";
    else if (splitMode === "unified") splitText = "Caja Única (Todo Compartido)";
    
    document.getElementById("desc-division-method").textContent = splitText;
    document.getElementById("desc-pct-1").textContent = splitMode === "unified" ? "-" : `${Math.round(ratio1 * 100)}%`;
    document.getElementById("desc-pct-2").textContent = splitMode === "unified" ? "-" : `${Math.round(ratio2 * 100)}%`;
    
    const configDisplay = document.getElementById("config-proportion-preview");
    if (configDisplay) {
        if (splitMode === "unified") {
            configDisplay.innerHTML = `
                <strong>Proporciones del Hogar:</strong><br>
                Caja Única / Cuentas Unificadas.<br>
                No se calculan deudas individuales de gastos comunes.
            `;
        } else {
            configDisplay.innerHTML = `
                <strong>Proporciones del Hogar:</strong><br>
                ${state.config.member1}: ${Math.round(ratio1 * 100)}% de aportes individuales.<br>
                ${state.config.member2}: ${Math.round(ratio2 * 100)}% de aportes individuales.
            `;
        }
    }
    
    // Calculate debts
    // Cris paid -> Flor's share
    // Flor paid -> Cris's share
    let florOwesCris = 0;
    let crisOwesFlor = 0;
    
    // Gather all expenses
    const allExpenses = [...fixedList, ...varList];
    
    allExpenses.forEach(exp => {
        const amt = Number(exp.amount);
        if (exp.split === "shared") {
            // Shared common expenses
            if (exp.payer === "member1") {
                // Cris paid, Flor owes Flor's share
                florOwesCris += amt * ratio2;
            } else {
                // Flor paid, Cris owes Cris's share
                crisOwesFlor += amt * ratio1;
            }
        } else if (exp.split === "member1") {
            // Solo Cris expense
            if (exp.payer === "member2") {
                // Flor paid for Cris's personal expense, Cris owes the full amount
                crisOwesFlor += amt;
            }
        } else if (exp.split === "member2") {
            // Solo Flor expense
            if (exp.payer === "member1") {
                // Cris paid for Flor's personal expense, Flor owes the full amount
                florOwesCris += amt;
            }
        }
    });
    
    // Settlement display card handling
    const settlementCard = document.querySelector(".settlement-card");
    if (state.config.splitMode === "unified") {
        settlementCard.style.display = "none";
    } else {
        settlementCard.style.display = "flex";
        const titleEl = document.getElementById("settlement-title");
        const detailsEl = document.getElementById("settlement-details");
        const valEl = document.getElementById("settlement-value");
        
        if (florOwesCris > crisOwesFlor) {
            const diff = florOwesCris - crisOwesFlor;
            titleEl.textContent = `${state.config.member2} le debe a ${state.config.member1}`;
            detailsEl.textContent = `Basado en aportes y gastos comunes del mes. Liquidar deuda directa.`;
            valEl.textContent = formatVal(diff);
            valEl.className = "settlement-amount";
        } else if (crisOwesFlor > florOwesCris) {
            const diff = crisOwesFlor - florOwesCris;
            titleEl.textContent = `${state.config.member1} le debe a ${state.config.member2}`;
            detailsEl.textContent = `Basado en aportes y gastos comunes del mes. Liquidar deuda directa.`;
            valEl.textContent = formatVal(diff);
            valEl.className = "settlement-amount";
        } else {
            titleEl.textContent = "Cuentas al Día";
            detailsEl.textContent = "Excelente gestión. No hay saldos pendientes entre ustedes este mes.";
            valEl.textContent = formatVal(0);
            valEl.className = "settlement-amount none";
        }
    }
    
    // Render Dashboard Charts
    renderCharts(currentData, incomeMember1, incomeMember2, allExpenses, ratio1, ratio2);
}

// --- CHARTS GENERATION ---
function renderCharts(currentData, inc1, inc2, allExpenses, r1, r2) {
    if (!currentData) return;
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js no está cargado. Se omitirá el renderizado de gráficos.");
        return;
    }
    try {
    
    // A. Chart 1: Expenses by Category
    const categoryTotals = {};
    allExpenses.forEach(exp => {
        // Categorize Fixed expenses as "Fijos/Servicios" if no variable category
        const cat = exp.category || "Gastos Fijos";
        categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(exp.amount);
    });
    
    const catLabels = Object.keys(categoryTotals);
    const catValues = Object.values(categoryTotals);
    
    const ctxCat = document.getElementById("chart-expenses-categories");
    if (ctxCat) {
        if (categoryChart) categoryChart.destroy();
        
        if (catValues.length === 0) {
            // Draw empty state chart or display warning
            categoryChart = new Chart(ctxCat, {
                type: 'doughnut',
                data: {
                    labels: ['Sin gastos'],
                    datasets: [{
                        data: [1],
                        backgroundColor: ['rgba(255, 255, 255, 0.05)'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } }
                }
            });
        } else {
            categoryChart = new Chart(ctxCat, {
                type: 'doughnut',
                data: {
                    labels: catLabels,
                    datasets: [{
                        data: catValues,
                        backgroundColor: [
                            '#8b5cf6', // Violet
                            '#06b6d4', // Cyan
                            '#10b981', // Emerald
                            '#f43f5e', // Rose
                            '#f59e0b', // Amber
                            '#3b82f6', // Blue
                            '#6b7280'  // Slate
                        ],
                        borderColor: 'rgba(10, 15, 30, 0.9)',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                color: '#e5e7eb',
                                font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' },
                                padding: 15
                            }
                        }
                    },
                    cutout: '65%'
                }
            });
        }
    }
    
    // B. Chart 2: Partner Comparison (Income, Paid, Responsible)
    // Calculate paid amount and responsible amount for each partner
    let paid1 = 0;
    let paid2 = 0;
    
    let resp1 = 0;
    let resp2 = 0;
    
    allExpenses.forEach(exp => {
        const amt = Number(exp.amount);
        
        // Paid Tracking
        if (exp.payer === "member1") paid1 += amt;
        else paid2 += amt;
        
        // Responsible Tracking
        if (exp.split === "shared") {
            resp1 += amt * r1;
            resp2 += amt * r2;
        } else if (exp.split === "member1") {
            resp1 += amt;
        } else if (exp.split === "member2") {
            resp2 += amt;
        }
    });
    
    const ctxComp = document.getElementById("chart-partner-comparison");
    if (ctxComp) {
        if (comparisonChart) comparisonChart.destroy();
        
        const isUnified = state.config.splitMode === "unified";
        const chartLabels = isUnified ? ['Ingreso', 'Pagado (Caja)'] : ['Ingreso', 'Pagado (Caja)', 'Corresponde (Responsabilidad)'];
        const data1 = isUnified ? [inc1, paid1] : [inc1, paid1, resp1];
        const data2 = isUnified ? [inc2, paid2] : [inc2, paid2, resp2];
        
        comparisonChart = new Chart(ctxComp, {
            type: 'bar',
            data: {
                labels: chartLabels,
                datasets: [
                    {
                        label: state.config.member1,
                        data: data1,
                        backgroundColor: 'rgba(139, 92, 246, 0.75)',
                        borderColor: 'var(--color-primary)',
                        borderWidth: 1.5,
                        borderRadius: 6
                    },
                    {
                        label: state.config.member2,
                        data: data2,
                        backgroundColor: 'rgba(6, 182, 212, 0.75)',
                        borderColor: 'var(--color-secondary)',
                        borderWidth: 1.5,
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: '#e5e7eb',
                            font: { family: 'Plus Jakarta Sans', weight: '600' }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', size: 10 } },
                        grid: { display: false }
                    },
                    y: {
                        ticks: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', size: 10 } },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    }
                }
            }
        });
    }
    } catch (error) {
        console.error("Error en renderCharts: ", error);
    }
}

// --- EVENT LISTENERS & FORM SUBMISSIONS ---
function setupEventListeners() {
    // Tab switching
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", () => {
            const tabId = item.getAttribute("data-tab");
            switchTab(tabId);
        });
    });
    
    // Month Selector Change
    document.getElementById("month-selector").addEventListener("change", (e) => {
        state.currentMonth = e.target.value;
        saveState();
        renderApp();
    });
    
    // Add Income
    document.getElementById("form-income").addEventListener("submit", (e) => {
        e.preventDefault();
        const desc = document.getElementById("income-desc").value.trim();
        const owner = document.getElementById("income-owner").value;
        const amount = Number(document.getElementById("income-amount").value);
        const dateVal = document.getElementById("income-date").value;
        
        if (desc && amount > 0 && dateVal) {
            const destMonth = dateVal.substring(0, 7); // "YYYY-MM"
            ensureMonthExists(destMonth);
            
            state.months[destMonth].income.push({
                id: 'inc-' + Date.now(),
                desc,
                owner,
                amount,
                date: dateVal
            });
            
            document.getElementById("form-income").reset();
            
            if (destMonth !== state.currentMonth) {
                showToast(`Ingreso registrado en ${destMonth} por la fecha elegida.`, "success");
            }
            
            saveState();
            renderApp();
        }
    });
    
    // Add Fixed Expense
    document.getElementById("form-expenses-fixed").addEventListener("submit", (e) => {
        e.preventDefault();
        const desc = document.getElementById("fixed-desc").value.trim();
        const payer = document.getElementById("fixed-payer").value;
        const split = document.getElementById("fixed-split").value;
        const amount = Number(document.getElementById("fixed-amount").value);
        const dateVal = document.getElementById("fixed-date").value;
        
        if (desc && amount > 0 && dateVal) {
            const destMonth = dateVal.substring(0, 7); // "YYYY-MM"
            ensureMonthExists(destMonth);
            
            state.months[destMonth].fixedExpenses.push({
                id: 'fix-' + Date.now(),
                desc,
                payer,
                split,
                amount,
                date: dateVal
            });
            
            document.getElementById("form-expenses-fixed").reset();
            
            if (destMonth !== state.currentMonth) {
                showToast(`Egreso fijo registrado en ${destMonth} por la fecha elegida.`, "success");
            }
            
            saveState();
            renderApp();
        }
    });
    
    // Add Variable Expense
    document.getElementById("form-expenses-var").addEventListener("submit", (e) => {
        e.preventDefault();
        const desc = document.getElementById("var-desc").value.trim();
        const category = document.getElementById("var-category").value;
        const payer = document.getElementById("var-payer").value;
        const split = document.getElementById("var-split").value;
        const amount = Number(document.getElementById("var-amount").value);
        const dateVal = document.getElementById("var-date").value;
        
        if (desc && amount > 0 && dateVal) {
            const destMonth = dateVal.substring(0, 7); // "YYYY-MM"
            ensureMonthExists(destMonth);
            
            state.months[destMonth].varExpenses.push({
                id: 'var-' + Date.now(),
                desc,
                category,
                payer,
                split,
                amount,
                date: dateVal
            });
            
            document.getElementById("form-expenses-var").reset();
            
            if (destMonth !== state.currentMonth) {
                showToast(`Egreso variable registrado en ${destMonth} por la fecha elegida.`, "success");
            }
            
            saveState();
            renderApp();
        }
    });
    
    // Add Savings Goal
    document.getElementById("form-savings").addEventListener("submit", (e) => {
        e.preventDefault();
        const desc = document.getElementById("savings-desc").value.trim();
        const category = "Ahorro"; // Hardcoded
        const currency = document.getElementById("savings-currency").value.trim() || "€";
        const saved = Number(document.getElementById("savings-saved").value);
        const target = Number(document.getElementById("savings-target").value);
        
        if (desc && target > 0) {
            state.months[state.currentMonth].savings.push({
                id: 'sav-' + Date.now(),
                desc,
                category,
                currency,
                saved,
                target
            });
            saveState();
            renderApp();
            document.getElementById("form-savings").reset();
            // Reset currency field to default value
            document.getElementById("savings-currency").value = "€";
        }
    });

    // Add Investment Goal
    document.getElementById("form-investments").addEventListener("submit", (e) => {
        e.preventDefault();
        const desc = document.getElementById("investments-desc").value.trim();
        const category = "Inversión"; // Hardcoded
        const currency = document.getElementById("investments-currency").value.trim() || "€";
        const saved = Number(document.getElementById("investments-saved").value);
        const target = Number(document.getElementById("investments-target").value);
        
        if (desc && target > 0) {
            state.months[state.currentMonth].savings.push({
                id: 'sav-' + Date.now(),
                desc,
                category,
                currency,
                saved,
                target
            });
            saveState();
            renderApp();
            document.getElementById("form-investments").reset();
            // Reset currency field to default value
            document.getElementById("investments-currency").value = "€";
        }
    });

    // Save Goal Edit Modal Form
    document.getElementById("form-edit-goal").addEventListener("submit", (e) => {
        e.preventDefault();
        const id = document.getElementById("edit-goal-id").value;
        const desc = document.getElementById("edit-goal-desc").value.trim();
        const category = document.getElementById("edit-goal-category").value;
        const currency = document.getElementById("edit-goal-currency").value.trim();
        const saved = Number(document.getElementById("edit-goal-saved").value);
        const target = Number(document.getElementById("edit-goal-target").value);
        
        if (desc && target > 0) {
            const list = state.months[state.currentMonth].savings;
            const goal = list.find(item => item.id === id);
            if (goal) {
                goal.desc = desc;
                goal.category = category;
                goal.currency = currency;
                goal.saved = saved;
                goal.target = target;
                
                saveState();
                renderApp();
                closeEditGoalModal();
            }
        }
    });
    
    // Save Couple Config settings
    document.getElementById("form-couple-settings").addEventListener("submit", (e) => {
        e.preventDefault();
        state.config.member1 = document.getElementById("config-name-1").value.trim();
        state.config.member2 = document.getElementById("config-name-2").value.trim();
        state.config.currency = document.getElementById("config-currency").value.trim();
        state.config.splitMode = document.getElementById("config-split-mode").value;
        
        saveState();
        renderApp();
        alert("¡Configuración de pareja actualizada con éxito!");
    });
    
    // Export PDF Report (Print style)
    document.getElementById("btn-export-pdf").addEventListener("click", () => {
        window.print();
    });

    // Export Excel (.xlsx)
    const btnExcelHeader = document.getElementById("btn-export-excel");
    if (btnExcelHeader) {
        btnExcelHeader.addEventListener("click", exportToExcel);
    }
    
    const btnExcelConfig = document.getElementById("btn-export-excel-config");
    if (btnExcelConfig) {
        btnExcelConfig.addEventListener("click", exportToExcel);
    }

    // Add Upcoming Expense Form Submit
    const formUpcoming = document.getElementById("form-upcoming");
    if (formUpcoming) {
        formUpcoming.addEventListener("submit", (e) => {
            e.preventDefault();
            const date = document.getElementById("upcoming-date").value;
            const desc = document.getElementById("upcoming-desc").value.trim();
            const category = document.getElementById("upcoming-category").value;
            const payer = document.getElementById("upcoming-payer").value;
            const split = document.getElementById("upcoming-split").value;
            const amount = Number(document.getElementById("upcoming-amount").value);

            if (date && desc && amount > 0) {
                if (!Array.isArray(state.savedBudgets) || state.savedBudgets.length === 0) {
                    state.savedBudgets = [
                        { id: 'sb_october', name: '📅 Presupuesto Octubre', createdAt: new Date().toISOString(), items: [] }
                    ];
                    state.activeBudgetId = 'sb_october';
                }
                const activeFolder = state.savedBudgets.find(b => b.id === state.activeBudgetId) || state.savedBudgets[0];
                if (!Array.isArray(activeFolder.items)) {
                    activeFolder.items = [];
                }
                activeFolder.items.push({
                    id: 'up_' + Date.now(),
                    date,
                    desc,
                    category,
                    payer,
                    split,
                    amount
                });

                formUpcoming.reset();
                saveState();
                renderUpcomingExpenses();
                showToast(`¡Añadido a la carpeta "${activeFolder.name}"!`, "success");
            }
        });
    }

    // Export Period Excel Button
    const btnExportPeriod = document.getElementById("btn-export-period-excel");
    if (btnExportPeriod) {
        btnExportPeriod.addEventListener("click", exportPeriodToExcel);
    }
    
    // Export Database (JSON download)
    document.getElementById("btn-export-data").addEventListener("click", () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `DuetBudget_Backup_${state.currentMonth}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    });
    
    // Import Database (JSON upload)
    document.getElementById("btn-import-data").addEventListener("change", (e) => {
        const fileReader = new FileReader();
        fileReader.onload = function(event) {
            try {
                const parsedState = JSON.parse(event.target.result);
                if (parsedState.config && parsedState.months) {
                    state = parsedState;
                    saveState();
                    initializeMonthSelector();
                    renderApp();
                    alert("¡Presupuesto importado con éxito!");
                } else {
                    alert("Archivo JSON no válido. Asegúrate de importar un archivo exportado por DuetBudget.");
                }
            } catch (err) {
                alert("Error al leer el archivo. Verifica el formato.");
            }
        };
        if (e.target.files.length > 0) {
            fileReader.readAsText(e.target.files[0]);
        }
    });
    
    // Reset Database
    document.getElementById("btn-reset-data").addEventListener("click", () => {
        if (confirm("¿Estás seguro de que quieres restablecer todo? Se borrarán todos los meses de presupuesto de forma permanente.")) {
            seedState();
            initializeMonthSelector();
            renderApp();
            alert("Aplicación restablecida a los valores iniciales de Cris y Flor.");
        }
    });
    
    // Formulario de Supabase (Sincronización)
    document.getElementById("form-supabase-settings").addEventListener("submit", (e) => {
        e.preventDefault();
        const url = document.getElementById("config-supabase-url").value.trim();
        const key = document.getElementById("config-supabase-key").value.trim();
        connectSupabase(url, key, true);
    });

    // Botón Desconectar Supabase
    document.getElementById("btn-supabase-disconnect").addEventListener("click", () => {
        if (confirm("¿Estás seguro de que deseas desconectar de la nube? Los datos volverán a guardarse únicamente de forma local.")) {
            disconnectSupabase();
        }
    });

    // Botón Conflicto: Descargar de Nube
    document.getElementById("btn-conflict-download").addEventListener("click", () => {
        if (pendingRemoteState) {
            state = pendingRemoteState;
            saveStateLocalOnly();
            renderApp();
            closeConflictModal();
            showToast("Presupuesto de la nube cargado y sincronizado con éxito.", "success");
        }
    });

    // Botón Conflicto: Subir a Nube
    document.getElementById("btn-conflict-upload").addEventListener("click", () => {
        if (supabaseClient) {
            updateSupabaseStatusBadge("connecting", "Subiendo...");
            supabaseClient
                .from('duet_budget')
                .update({ data: state, updated_at: new Date().toISOString() })
                .eq('id', 'default')
                .then(({ error }) => {
                    if (error) {
                        showToast("Error al subir los datos locales: " + error.message, "error");
                        updateSupabaseStatusBadge("error", "Error al subir");
                    } else {
                        updateSupabaseStatusBadge("connected", "Sincronizado");
                        showToast("Datos locales subidos a la nube con éxito.", "success");
                    }
                    closeConflictModal();
                });
        }
    });

    // Guardar cambios del modal de edición de ingresos/egresos
    document.getElementById("form-edit-item").addEventListener("submit", (e) => {
        e.preventDefault();
        const id = document.getElementById("edit-item-id").value;
        const type = document.getElementById("edit-item-type").value;
        const desc = document.getElementById("edit-item-desc").value.trim();
        const amount = Number(document.getElementById("edit-item-amount").value);
        const dateVal = document.getElementById("edit-item-date").value;
        
        if (type === 'upcoming') {
            const activeFolder = state.savedBudgets.find(b => b.id === state.activeBudgetId) || state.savedBudgets[0];
            const item = (activeFolder.items || []).find(x => x.id === id);
            if (item) {
                item.desc = desc;
                item.amount = amount;
                item.date = dateVal;
                if (document.getElementById("edit-item-category")) item.category = document.getElementById("edit-item-category").value;
                if (document.getElementById("edit-item-payer")) item.payer = document.getElementById("edit-item-payer").value;
                if (document.getElementById("edit-item-split")) item.split = document.getElementById("edit-item-split").value;
                saveState();
                renderUpcomingExpenses();
                closeEditItemModal();
                showToast("Gasto presupuestado actualizado con éxito.", "success");
            }
            return;
        }

        if (desc && amount > 0 && dateVal) {
            const currentMonthData = state.months[state.currentMonth];
            const list = currentMonthData ? currentMonthData[type] : [];
            const itemIndex = list.findIndex(x => x.id === id);
            
            if (itemIndex !== -1) {
                // Obtener objeto original para actualizar
                const item = list[itemIndex];
                item.desc = desc;
                item.amount = amount;
                item.date = dateVal;
                
                // Campos dinámicos según el tipo de registro
                if (type === 'income') {
                    item.owner = document.getElementById("edit-item-owner").value;
                } else {
                    item.payer = document.getElementById("edit-item-payer").value;
                    item.split = document.getElementById("edit-item-split").value;
                    if (type === 'varExpenses') {
                        item.category = document.getElementById("edit-item-category").value;
                    }
                }
                
                // Comprobar si cambió el mes del registro
                const destMonth = dateVal.substring(0, 7);
                if (destMonth !== state.currentMonth) {
                    // Remover de la lista del mes actual
                    list.splice(itemIndex, 1);
                    
                    // Asegurar que el mes destino exista y añadir el registro
                    ensureMonthExists(destMonth);
                    state.months[destMonth][type].push(item);
                    
                    showToast(`Registro movido a ${destMonth} debido al cambio de fecha.`, "success");
                } else {
                    showToast("Registro actualizado con éxito.", "success");
                }
                
                saveState();
                renderApp();
                closeEditItemModal();
            }
        }
    });
}

// --- TOAST NOTIFICATIONS ---
function showToast(message, type = 'info') {
    const container = document.getElementById("toast-container");
    if (!container) return;
    
    const toast = document.createElement("div");
    toast.className = `toast-notification ${type}`;
    
    let icon = "ℹ️";
    if (type === 'success') icon = "✅";
    if (type === 'error') icon = "❌";
    
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add("active"), 10);
    
    setTimeout(() => {
        toast.classList.remove("active");
        setTimeout(() => toast.remove(), 350);
    }, 4000);
}

// --- SUPABASE SYNCRONIZATION ENGINE ---

// Carga las credenciales guardadas e inicia conexión silenciosa
function loadSupabaseConfig() {
    const url = localStorage.getItem("duetbudget_supabase_url");
    const key = localStorage.getItem("duetbudget_supabase_key");
    if (url && key) {
        document.getElementById("config-supabase-url").value = url;
        document.getElementById("config-supabase-key").value = key;
        connectSupabase(url, key, false);
    }
}

// Conectar e inicializar cliente
async function connectSupabase(url, key, isManualConnection = false) {
    updateSupabaseStatusBadge("connecting", "Conectando...");
    
    if (typeof supabase === 'undefined') {
        updateSupabaseStatusBadge("error", "SDK no cargado");
        if (isManualConnection) showToast("Error: No se pudo instanciar el cliente Supabase (SDK no cargado).", "error");
        return;
    }
    
    try {
        supabaseClient = supabase.createClient(url, key);
        
        // Comprobar conexión intentando seleccionar la fila default
        const { data, error, status } = await supabaseClient
            .from('duet_budget')
            .select('data, updated_at')
            .eq('id', 'default')
            .maybeSingle();
            
        if (error && status !== 406) {
            throw error;
        }
        
        // Guardar credenciales válidas
        localStorage.setItem("duetbudget_supabase_url", url);
        localStorage.setItem("duetbudget_supabase_key", key);
        
        // Actualizar interfaz
        document.getElementById("btn-supabase-disconnect").style.display = "block";
        const connBtn = document.getElementById("btn-supabase-connect");
        connBtn.textContent = "Conectado";
        connBtn.disabled = true;
        
        updateSupabaseStatusBadge("connected", "Sincronizado");
        
        if (data) {
            const remoteState = data.data;
            const localStateStr = localStorage.getItem("duetbudget_state_clean");
            
            if (localStateStr) {
                const localState = JSON.parse(localStateStr);
                if (JSON.stringify(remoteState) !== JSON.stringify(localState)) {
                    if (isManualConnection) {
                        // Conflicto manual de primera conexión
                        showConflictModal(remoteState);
                    } else {
                        // Sincronización silenciosa en carga de página: Nube manda (Source of Truth)
                        state = remoteState;
                        saveStateLocalOnly();
                        renderApp();
                    }
                } else {
                    // Datos idénticos, cargar de la nube
                    state = remoteState;
                    saveStateLocalOnly();
                    renderApp();
                    if (isManualConnection) showToast("¡Conectado y sincronizado!", "success");
                }
            } else {
                // Sin estado local, descargar remoto
                state = remoteState;
                saveStateLocalOnly();
                renderApp();
                if (isManualConnection) showToast("¡Sincronizado desde la nube!", "success");
            }
        } else {
            // Tabla existe pero sin fila default. Crear fila con datos locales
            const { error: insertError } = await supabaseClient
                .from('duet_budget')
                .insert({ id: 'default', data: state, updated_at: new Date().toISOString() });
                
            if (insertError) throw insertError;
            
            if (isManualConnection) showToast("¡Conectado! Datos locales inicializados en la nube.", "success");
        }
        
        // Suscribirse a tiempo real
        setupSupabaseRealtime();
        
    } catch (err) {
        console.error("Error en conexión Supabase:", err);
        updateSupabaseStatusBadge("error", "Error de conexión");
        if (isManualConnection) {
            showToast("Error de conexión. Verifica la consola o el script SQL.", "error");
        }
    }
}

// Desconectar y volver a local
function disconnectSupabase() {
    if (supabaseChannel) {
        if (supabaseClient) supabaseClient.removeChannel(supabaseChannel);
        supabaseChannel = null;
    }
    supabaseClient = null;
    
    localStorage.removeItem("duetbudget_supabase_url");
    localStorage.removeItem("duetbudget_supabase_key");
    
    document.getElementById("config-supabase-url").value = "";
    document.getElementById("config-supabase-key").value = "";
    
    document.getElementById("btn-supabase-disconnect").style.display = "none";
    const connBtn = document.getElementById("btn-supabase-connect");
    connBtn.textContent = "Conectar y Sincronizar";
    connBtn.disabled = false;
    
    updateSupabaseStatusBadge("local", "Modo Local (Sin nube)");
    showToast("Desconectado de Supabase. Modo local activado.", "info");
}

// Actualizar indicador visual
function updateSupabaseStatusBadge(status, text) {
    const badge = document.getElementById("supabase-status-badge");
    if (!badge) return;
    badge.className = `sync-badge status-${status}`;
    badge.textContent = text;
}

// Suscripción Realtime por WebSockets
function setupSupabaseRealtime() {
    if (!supabaseClient) return;
    
    if (supabaseChannel) {
        supabaseClient.removeChannel(supabaseChannel);
    }
    
    supabaseChannel = supabaseClient
        .channel('public:duet_budget')
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'duet_budget', filter: 'id=eq.default' },
            (payload) => {
                if (payload.new && payload.new.data) {
                    const remoteState = payload.new.data;
                    
                    // Solo actualizar si hay cambios reales respecto al estado en memoria
                    if (JSON.stringify(remoteState) !== JSON.stringify(state)) {
                        state = remoteState;
                        saveStateLocalOnly();
                        renderApp();
                        showToast("¡Presupuesto actualizado en tiempo real!", "success");
                    }
                }
            }
        )
        .subscribe();
}

// Guardado local aislado para evitar bucles
function saveStateLocalOnly() {
    isLocalSaveOnly = true;
    saveState();
    isLocalSaveOnly = false;
}

// Control modal de conflictos
let pendingRemoteState = null;
function showConflictModal(remoteState) {
    pendingRemoteState = remoteState;
    document.getElementById("conflict-modal").classList.add("active");
}

function closeConflictModal() {
    document.getElementById("conflict-modal").classList.remove("active");
    pendingRemoteState = null;
}

// Helper to render premium currency breakdown list inside Dashboard cards
function renderCurrencyBreakdown(groupData, isInvestment = false) {
    const currencies = Object.keys(groupData);
    if (currencies.length === 0) {
        return `
            <div style="font-size: 1.65rem; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 0.25rem;">
                0,00 ${state.config.currency}
            </div>
        `;
    }
    
    let html = '<div class="premium-breakdown-list">';
    currencies.forEach(curr => {
        const item = groupData[curr];
        const percent = item.target > 0 ? Math.min(Math.round((item.saved / item.target) * 100), 100) : 0;
        const displaySaved = formatCurrencyCustom(item.saved, curr);
        const displayTarget = formatCurrencyCustom(item.target, curr);
        
        // Use secondary color for investments, primary for savings
        const barColor = isInvestment ? 'var(--color-secondary)' : 'var(--color-primary)';
        
        html += `
            <div class="breakdown-item">
                <div class="breakdown-row-top">
                    <span class="breakdown-asset-badge">${curr.toUpperCase()}</span>
                    <span class="breakdown-saved-val">${displaySaved}</span>
                </div>
                <div class="breakdown-row-bottom">
                    <div class="breakdown-progress-container">
                        <div class="breakdown-progress-bar" style="width: ${percent}%; background: ${barColor};"></div>
                    </div>
                    <span class="breakdown-target-val">Meta: ${displayTarget} (${percent}%)</span>
                </div>
            </div>
        `;
    });
    html += '</div>';
    return html;
}

// Open and populate generic edit item modal
window.openEditItemModal = function(type, id) {
    let list = [];
    if (type === 'upcoming') {
        const activeFolder = state.savedBudgets.find(b => b.id === state.activeBudgetId) || state.savedBudgets[0];
        list = activeFolder.items || [];
    } else {
        const currentMonthData = state.months[state.currentMonth];
        list = currentMonthData ? currentMonthData[type] : [];
    }
    const item = list.find(x => x.id === id);
    if (!item) return;
    
    document.getElementById("edit-item-id").value = item.id;
    document.getElementById("edit-item-type").value = type;
    document.getElementById("edit-item-desc").value = item.desc;
    document.getElementById("edit-item-amount").value = item.amount;
    
    // Default date to active month's 1st day if it doesn't have a date
    const itemDate = item.date || `${state.currentMonth}-01`;
    document.getElementById("edit-item-date").value = itemDate;
    
    // Set title based on type
    const titleEl = document.getElementById("edit-item-title");
    if (type === 'income') titleEl.textContent = "Editar Ingreso";
    else if (type === 'fixedExpenses') titleEl.textContent = "Editar Egreso Fijo";
    else if (type === 'upcoming') titleEl.textContent = "Editar Gasto Presupuestado";
    else titleEl.textContent = "Editar Egreso Variable";
    
    // Populate dynamic fields
    const dynamicContainer = document.getElementById("edit-item-dynamic-fields");
    dynamicContainer.innerHTML = "";
    
    if (type === 'income') {
        dynamicContainer.innerHTML = `
            <div class="config-form-group">
                <label for="edit-item-owner">Proveedor / Integrante</label>
                <select id="edit-item-owner" required>
                    <option value="member1">${state.config.member1}</option>
                    <option value="member2">${state.config.member2}</option>
                    <option value="shared">Común (Pasivos/Ventas)</option>
                </select>
            </div>
        `;
        document.getElementById("edit-item-owner").value = item.owner || "shared";
    } else if (type === 'fixedExpenses') {
        dynamicContainer.innerHTML = `
            <div class="config-form-group">
                <label for="edit-item-payer">Pagador</label>
                <select id="edit-item-payer" required>
                    <option value="member1">Pagó ${state.config.member1}</option>
                    <option value="member2">Pagó ${state.config.member2}</option>
                </select>
            </div>
            <div class="config-form-group">
                <label for="edit-item-split">Destinado a</label>
                <select id="edit-item-split" required>
                    <option value="shared">Dividido (Común)</option>
                    <option value="member1">Solo ${state.config.member1}</option>
                    <option value="member2">Solo ${state.config.member2}</option>
                </select>
            </div>
        `;
        document.getElementById("edit-item-payer").value = item.payer || "member1";
        document.getElementById("edit-item-split").value = item.split || "shared";
    } else if (type === 'varExpenses' || type === 'upcoming') {
        dynamicContainer.innerHTML = `
            <div class="config-form-group">
                <label for="edit-item-category">Categoría</label>
                <select id="edit-item-category" required>
                    <option value="Alimentación">Alimentación</option>
                    <option value="Salidas y Ocio">Salidas/Ocio</option>
                    <option value="Transporte">Transporte</option>
                    <option value="Salud y Cuidado">Salud/Cuidado</option>
                    <option value="Suscripciones">Suscripciones</option>
                    <option value="Hogar">Hogar</option>
                    <option value="Viajes">Viajes</option>
                    <option value="Otros">Otros</option>
                </select>
            </div>
            <div class="config-form-group">
                <label for="edit-item-payer">Pagador</label>
                <select id="edit-item-payer" required>
                    <option value="member1">Pagó ${state.config.member1}</option>
                    <option value="member2">Pagó ${state.config.member2}</option>
                </select>
            </div>
            <div class="config-form-group">
                <label for="edit-item-split">Destinado a</label>
                <select id="edit-item-split" required>
                    <option value="shared">Dividido (Común)</option>
                    <option value="member1">Solo ${state.config.member1}</option>
                    <option value="member2">Solo ${state.config.member2}</option>
                </select>
            </div>
        `;
        document.getElementById("edit-item-category").value = item.category || "Otros";
        document.getElementById("edit-item-payer").value = item.payer || "member1";
        document.getElementById("edit-item-split").value = item.split || "shared";
    }
    
    // Workaround to fix dark dropdown background options in newly added select
    const selects = dynamicContainer.querySelectorAll("select");
    selects.forEach(sel => {
        const currentVal = sel.value;
        // Apply names from state
        if (sel.id === "edit-item-owner") {
            sel.options[0].textContent = state.config.member1;
            sel.options[1].textContent = state.config.member2;
        } else if (sel.id === "edit-item-payer") {
            sel.options[0].textContent = `Pagó ${state.config.member1}`;
            sel.options[1].textContent = `Pagó ${state.config.member2}`;
        } else if (sel.id === "edit-item-split") {
            sel.options[1].textContent = `Solo ${state.config.member1}`;
            sel.options[2].textContent = `Solo ${state.config.member2}`;
        }
        sel.value = currentVal;
    });
    
    document.getElementById("edit-item-modal").classList.add("active");
};

window.closeEditItemModal = function() {
    document.getElementById("edit-item-modal").classList.remove("active");
};

window.toggleSortOrder = toggleSortOrder;

// Export Month Data to Excel Workbook (.xlsx)
function exportToExcel() {
    try {
        const currentData = state.months[state.currentMonth] || { income: [], fixedExpenses: [], varExpenses: [], savings: [] };
        const member1 = state.config.member1 || "Cris";
        const member2 = state.config.member2 || "Flor";
        const currency = state.config.currency || "$";

        // Calculate Totals for Summary Sheet
        let totalInc = 0;
        let incM1 = 0, incM2 = 0, incShared = 0;
        (currentData.income || []).forEach(inc => {
            const amt = Number(inc.amount) || 0;
            totalInc += amt;
            if (inc.owner === "member1") incM1 += amt;
            else if (inc.owner === "member2") incM2 += amt;
            else incShared += amt;
        });

        let totalFixed = 0;
        (currentData.fixedExpenses || []).forEach(exp => totalFixed += (Number(exp.amount) || 0));

        let totalVar = 0;
        (currentData.varExpenses || []).forEach(exp => totalVar += (Number(exp.amount) || 0));

        let totalExp = totalFixed + totalVar;
        let totalSav = 0;
        let totalInv = 0;
        (currentData.savings || []).forEach(sav => {
            if (sav.category === "Ahorro") totalSav += (Number(sav.saved) || 0);
            else totalInv += (Number(sav.saved) || 0);
        });

        let netBalance = totalInc - totalExp;

        // 1. Resumen Data
        const summaryData = [
            { "Concepto": "Mes de Presupuesto", "Detalle / Valor": state.currentMonth },
            { "Concepto": `Ingresos Totales`, "Detalle / Valor": `${currency}${totalInc.toFixed(2)}` },
            { "Concepto": `Ingresos ${member1}`, "Detalle / Valor": `${currency}${incM1.toFixed(2)}` },
            { "Concepto": `Ingresos ${member2}`, "Detalle / Valor": `${currency}${incM2.toFixed(2)}` },
            { "Concepto": `Ingresos Comunes / Pasivos`, "Detalle / Valor": `${currency}${incShared.toFixed(2)}` },
            { "Concepto": "Egresos Fijos Totales", "Detalle / Valor": `${currency}${totalFixed.toFixed(2)}` },
            { "Concepto": "Egresos Variables Totales", "Detalle / Valor": `${currency}${totalVar.toFixed(2)}` },
            { "Concepto": "Egresos Totales (Fijos + Variables)", "Detalle / Valor": `${currency}${totalExp.toFixed(2)}` },
            { "Concepto": "Ahorros Acumulados", "Detalle / Valor": `${currency}${totalSav.toFixed(2)}` },
            { "Concepto": "Inversiones Acumuladas", "Detalle / Valor": `${currency}${totalInv.toFixed(2)}` },
            { "Concepto": "Balance Disponible (Ingresos - Gastos)", "Detalle / Valor": `${currency}${netBalance.toFixed(2)}` }
        ];

        // Add settlement info if present
        const settlementTitleEl = document.getElementById("settlement-title");
        const settlementDetailsEl = document.getElementById("settlement-details");
        const settlementValEl = document.getElementById("settlement-value");
        if (settlementTitleEl && settlementValEl) {
            summaryData.push({ "Concepto": "Cuentas Claras (Liquidación)", "Detalle / Valor": `${settlementTitleEl.textContent}: ${settlementValEl.textContent} (${settlementDetailsEl.textContent})` });
        }

        // 2. Ingresos Data
        const incomeRows = sortItemsByDate(currentData.income || [], 'asc').map(inc => ({
            "Fecha": formatDateDisplay(inc.date || `${state.currentMonth}-01`),
            "Descripción": inc.desc || "",
            "Proveedor": inc.owner === "member1" ? member1 : (inc.owner === "member2" ? member2 : "Común / Compartido"),
            "Monto": Number(inc.amount) || 0
        }));

        // 3. Egresos Fijos Data
        const fixedRows = sortItemsByDate(currentData.fixedExpenses || [], 'asc').map(exp => ({
            "Fecha": formatDateDisplay(exp.date || `${state.currentMonth}-01`),
            "Descripción": exp.desc || "",
            "Pagado Por": exp.payer === "member1" ? member1 : member2,
            "Destinado A": exp.split === "shared" ? "Dividido (Común)" : (exp.split === "member1" ? `Solo ${member1}` : `Solo ${member2}`),
            "Monto": Number(exp.amount) || 0
        }));

        // 4. Egresos Variables Data
        const varRows = sortItemsByDate(currentData.varExpenses || [], 'asc').map(exp => ({
            "Fecha": formatDateDisplay(exp.date || `${state.currentMonth}-01`),
            "Descripción": exp.desc || "",
            "Categoría": exp.category || "Otros",
            "Pagado Por": exp.payer === "member1" ? member1 : member2,
            "Destinado A": exp.split === "shared" ? "Dividido (Común)" : (exp.split === "member1" ? `Solo ${member1}` : `Solo ${member2}`),
            "Monto": Number(exp.amount) || 0
        }));

        // 5. Metas Data
        const savingsRows = (currentData.savings || []).map(sav => {
            const saved = Number(sav.saved) || 0;
            const target = Number(sav.target) || 0;
            const pct = target > 0 ? `${Math.min(Math.round((saved / target) * 100), 100)}%` : "0%";
            return {
                "Meta / Inversión": sav.desc || "",
                "Tipo": sav.category || "Ahorro",
                "Divisa": sav.currency || currency,
                "Acumulado Actual": saved,
                "Meta Total": target,
                "% Cumplimiento": pct
            };
        });

        // Use SheetJS if available
        if (typeof XLSX !== 'undefined') {
            const wb = XLSX.utils.book_new();

            const wsSummary = XLSX.utils.json_to_sheet(summaryData);
            const wsIncome = XLSX.utils.json_to_sheet(incomeRows.length ? incomeRows : [{ "Fecha": "-", "Descripción": "Sin registros", "Proveedor": "-", "Monto": 0 }]);
            const wsFixed = XLSX.utils.json_to_sheet(fixedRows.length ? fixedRows : [{ "Fecha": "-", "Descripción": "Sin registros", "Pagado Por": "-", "Destinado A": "-", "Monto": 0 }]);
            const wsVar = XLSX.utils.json_to_sheet(varRows.length ? varRows : [{ "Fecha": "-", "Descripción": "Sin registros", "Categoría": "-", "Pagado Por": "-", "Destinado A": "-", "Monto": 0 }]);
            const wsSavings = XLSX.utils.json_to_sheet(savingsRows.length ? savingsRows : [{ "Meta / Inversión": "Sin metas", "Tipo": "-", "Divisa": "-", "Acumulado Actual": 0, "Meta Total": 0, "% Cumplimiento": "0%" }]);

            XLSX.utils.book_append_sheet(wb, wsSummary, "Resumen_Mes");
            XLSX.utils.book_append_sheet(wb, wsIncome, "Ingresos");
            XLSX.utils.book_append_sheet(wb, wsFixed, "Egresos_Fijos");
            XLSX.utils.book_append_sheet(wb, wsVar, "Egresos_Variables");
            XLSX.utils.book_append_sheet(wb, wsSavings, "Ahorros_e_Inversiones");

            // Add Próximos Gastos Sheet
            const upcomingRows = (state.upcomingExpenses || []).map(item => ({
                "Fecha Est.": formatDateDisplay(item.date || ""),
                "Descripción": item.desc || "",
                "Categoría": item.category || "Otros",
                "Pagador": item.payer === "member1" ? member1 : member2,
                "Destino": item.split === "shared" ? "Dividido (Común)" : (item.split === "member1" ? `Solo ${member1}` : `Solo ${member2}`),
                "Monto Est.": Number(item.amount) || 0,
                "Estado": item.status === "pagado" ? "Convertido" : "Pendiente"
            }));
            const wsUpcoming = XLSX.utils.json_to_sheet(upcomingRows.length ? upcomingRows : [{ "Fecha Est.": "-", "Descripción": "Sin gastos futuros", "Categoría": "-", "Pagador": "-", "Destino": "-", "Monto Est.": 0, "Estado": "-" }]);
            XLSX.utils.book_append_sheet(wb, wsUpcoming, "Próximos_Gastos");

            XLSX.writeFile(wb, `DuetBudget_${state.currentMonth}.xlsx`);
            showToast(`¡Presupuesto de ${state.currentMonth} exportado a Excel con éxito!`, "success");
        } else {
            // Fallback CSV generation if SheetJS CDN is offline
            let csvContent = "data:text/csv;charset=utf-8,";
            csvContent += `DuetBudget - ${state.currentMonth}\n\nRESUMEN\nConcepto,Valor\n`;
            summaryData.forEach(r => csvContent += `"${r["Concepto"]}","${r["Detalle / Valor"]}"\n`);
            
            csvContent += `\nINGRESOS\nFecha,Descripción,Proveedor,Monto\n`;
            incomeRows.forEach(r => csvContent += `"${r["Fecha"]}","${r["Descripción"]}","${r["Proveedor"]}",${r["Monto"]}\n`);
            
            csvContent += `\nEGRESOS FIJOS\nFecha,Descripción,Pagado Por,Destinado A,Monto\n`;
            fixedRows.forEach(r => csvContent += `"${r["Fecha"]}","${r["Descripción"]}","${r["Pagado Por"]}","${r["Destinado A"]}",${r["Monto"]}\n`);

            csvContent += `\nEGRESOS VARIABLES\nFecha,Descripción,Categoría,Pagado Por,Destinado A,Monto\n`;
            varRows.forEach(r => csvContent += `"${r["Fecha"]}","${r["Descripción"]}","${r["Categoría"]}","${r["Pagado Por"]}","${r["Destinado A"]}",${r["Monto"]}\n`);

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `DuetBudget_${state.currentMonth}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            showToast(`Presupuesto exportado como CSV de respaldo.`, "info");
        }
    } catch (err) {
        console.error("Error al exportar a Excel: ", err);
        showToast("Error al generar el archivo Excel: " + err.message, "error");
    }
}

// --- MODULE 1: BUDGET SIMULATOR & SCENARIO FOLDERS LOGIC ---

function populateBudgetScenarioSelector() {
    const select = document.getElementById("budget-scenario-select");
    if (!select) return;

    if (!Array.isArray(state.savedBudgets) || state.savedBudgets.length === 0) {
        state.savedBudgets = [
            { id: 'sb_october', name: '📅 Presupuesto Octubre', createdAt: new Date().toISOString(), items: [] },
            { id: 'sb_house', name: '🏠 Presupuesto Compra Casa', createdAt: new Date().toISOString(), items: [] },
            { id: 'sb_car', name: '🚗 Presupuesto Cambio Auto', createdAt: new Date().toISOString(), items: [] }
        ];
    }
    if (!state.activeBudgetId || !state.savedBudgets.some(b => b.id === state.activeBudgetId)) {
        state.activeBudgetId = state.savedBudgets[0].id;
    }

    select.innerHTML = "";
    state.savedBudgets.forEach(folder => {
        const option = document.createElement("option");
        option.value = folder.id;
        const count = (folder.items || []).length;
        option.textContent = `${folder.name} (${count} ítems)`;
        if (folder.id === state.activeBudgetId) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

window.switchBudgetScenario = function(folderId) {
    if (!folderId) return;
    state.activeBudgetId = folderId;
    saveState();
    renderUpcomingExpenses();
};

window.openNewBudgetModal = function() {
    const modal = document.getElementById("modal-new-budget");
    if (modal) {
        modal.style.display = "flex";
        const input = document.getElementById("new-budget-name");
        if (input) {
            input.value = "";
            input.focus();
        }
    }
};

window.closeNewBudgetModal = function() {
    const modal = document.getElementById("modal-new-budget");
    if (modal) {
        modal.style.display = "none";
    }
};

window.handleCreateNewBudgetFolder = function(e) {
    e.preventDefault();
    const input = document.getElementById("new-budget-name");
    const name = input ? input.value.trim() : "";
    if (!name) return;

    if (!Array.isArray(state.savedBudgets)) {
        state.savedBudgets = [];
    }

    const folderName = (name.startsWith('📁') || name.startsWith('🏠') || name.startsWith('🚗') || name.startsWith('✈️') || name.startsWith('📅')) 
        ? name 
        : `📁 ${name}`;

    const newFolder = {
        id: 'sb_' + Date.now(),
        name: folderName,
        createdAt: new Date().toISOString(),
        items: []
    };

    state.savedBudgets.push(newFolder);
    state.activeBudgetId = newFolder.id;

    saveState();
    closeNewBudgetModal();
    renderUpcomingExpenses();
    showToast(`¡Carpeta "${folderName}" creada con éxito!`, "success");
};

window.deleteActiveBudgetFolder = function() {
    if (!Array.isArray(state.savedBudgets) || state.savedBudgets.length <= 1) {
        showToast("Debes mantener al menos una carpeta de presupuesto.", "info");
        return;
    }

    const activeFolder = state.savedBudgets.find(b => b.id === state.activeBudgetId);
    const folderName = activeFolder ? activeFolder.name : "esta carpeta";

    if (confirm(`¿Estás seguro de que deseas eliminar la carpeta "${folderName}" y todos sus ítems presupuestados?`)) {
        state.savedBudgets = state.savedBudgets.filter(b => b.id !== state.activeBudgetId);
        state.activeBudgetId = state.savedBudgets[0].id;
        saveState();
        renderUpcomingExpenses();
        showToast(`Carpeta "${folderName}" eliminada.`, "info");
    }
};

function renderUpcomingExpenses() {
    if (!Array.isArray(state.savedBudgets) || state.savedBudgets.length === 0) {
        state.savedBudgets = [
            { id: 'sb_october', name: '📅 Presupuesto Octubre', createdAt: new Date().toISOString(), items: [] },
            { id: 'sb_house', name: '🏠 Presupuesto Compra Casa', createdAt: new Date().toISOString(), items: [] },
            { id: 'sb_car', name: '🚗 Presupuesto Cambio Auto', createdAt: new Date().toISOString(), items: [] }
        ];
    }
    if (!state.activeBudgetId || !state.savedBudgets.some(b => b.id === state.activeBudgetId)) {
        state.activeBudgetId = state.savedBudgets[0].id;
    }

    populateBudgetScenarioSelector();

    const activeFolder = state.savedBudgets.find(b => b.id === state.activeBudgetId) || state.savedBudgets[0];
    const items = activeFolder.items || [];

    let totalAmt = 0;
    let maxAmt = 0;
    let maxDesc = '-';

    items.forEach(item => {
        const amt = Number(item.amount) || 0;
        totalAmt += amt;
        if (amt > maxAmt) {
            maxAmt = amt;
            maxDesc = item.desc;
        }
    });

    const cardTotal = document.getElementById("card-upcoming-total");
    if (cardTotal) cardTotal.textContent = formatVal(totalAmt);

    const cardFolderName = document.getElementById("card-upcoming-folder-name");
    if (cardFolderName) cardFolderName.textContent = `Carpeta: ${activeFolder.name}`;

    const cardCount = document.getElementById("card-upcoming-count");
    if (cardCount) cardCount.textContent = `${items.length} ítem(s) presupuestados`;

    const cardMaxItem = document.getElementById("card-upcoming-max-item");
    if (cardMaxItem) cardMaxItem.textContent = maxDesc;

    const cardMaxAmt = document.getElementById("card-upcoming-max-amount");
    if (cardMaxAmt) cardMaxAmt.textContent = maxAmt > 0 ? `Monto: ${formatVal(maxAmt)}` : 'Sin registros';

    const tableTitle = document.getElementById("upcoming-table-title");
    if (tableTitle) tableTitle.textContent = `Gastos Potenciales: ${activeFolder.name}`;

    const tbody = document.getElementById("table-upcoming-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const sortedList = sortItemsByDate(items, sortOrders.upcoming || 'asc');
    const searchVal = document.getElementById("search-upcoming")?.value || "";
    const filteredList = filterListBySearch(sortedList, searchVal, "upcoming");

    const countBadge = document.getElementById("search-count-upcoming");
    if (countBadge) {
        countBadge.textContent = searchVal.trim() ? `${filteredList.length} de ${items.length}` : `${items.length} registrados`;
    }

    if (filteredList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">${searchVal.trim() ? 'No se encontraron gastos con ese filtro.' : `La carpeta "${activeFolder.name}" aún no tiene gastos presupuestados. Añade uno usando el formulario.`}</td></tr>`;
        return;
    }

    filteredList.forEach(item => {
        const tr = document.createElement("tr");
        const displayDate = formatDateDisplay(item.date || '');
        
        let payerLabel = item.payer === "member1" ? `<span class="badge badge-cris">${state.config.member1}</span>` : `<span class="badge badge-flor">${state.config.member2}</span>`;
        let splitLabel = "";
        if (item.split === "shared") splitLabel = `<span class="badge badge-shared">Común</span>`;
        else if (item.split === "member1") splitLabel = `<span class="badge badge-cris">Solo ${state.config.member1}</span>`;
        else splitLabel = `<span class="badge badge-flor">Solo ${state.config.member2}</span>`;

        tr.innerHTML = `
            <td>${displayDate}</td>
            <td style="font-weight:600;">${item.desc}</td>
            <td><span class="badge" style="background:rgba(255,255,255,0.06); color:var(--text-secondary); border:1px solid rgba(255,255,255,0.1);">${item.category || 'Otros'}</span></td>
            <td>${payerLabel} <span style="font-size:0.7rem; color:var(--text-muted);">(${splitLabel})</span></td>
            <td style="text-align: right; font-weight:700; color:#a78bfa;">${formatVal(item.amount)}</td>
            <td style="text-align: center;">
                <button class="btn btn-secondary" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; margin-right: 0.25rem;" onclick="openEditItemModal('upcoming', '${item.id}')">Editar</button>
                <button class="btn btn-danger" style="padding: 0.35rem 0.65rem; font-size: 0.75rem;" onclick="deleteUpcomingExpense('${item.id}')">Borrar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.deleteUpcomingExpense = function(id) {
    const activeFolder = state.savedBudgets.find(b => b.id === state.activeBudgetId);
    if (!activeFolder || !Array.isArray(activeFolder.items)) return;
    activeFolder.items = activeFolder.items.filter(x => x.id !== id);
    saveState();
    renderUpcomingExpenses();
    showToast("Ítem eliminado del presupuesto.", "info");
};

// --- MODULE 2: HISTORICAL PERIOD ANALYSIS LOGIC ---
function populatePeriodMonthSelectors(force = false) {
    const startSel = document.getElementById("period-start-month");
    const endSel = document.getElementById("period-end-month");
    if (!startSel || !endSel) return;

    // If options are already populated and force is false, do not destroy DOM options
    if (!force && startSel.options.length > 0 && endSel.options.length > 0) {
        return;
    }

    const currentStart = startSel.value;
    const currentEnd = endSel.value;

    const monthKeysSet = new Set(Object.keys(state.months || {}));
    
    // Always include a spectrum of months from 12 months ago to 6 months in future
    const now = new Date();
    for (let i = -12; i <= 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthKeysSet.add(key);
    }

    const sortedMonthKeys = Array.from(monthKeysSet).sort();
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    startSel.innerHTML = "";
    endSel.innerHTML = "";

    sortedMonthKeys.forEach((mKey) => {
        const [year, month] = mKey.split("-");
        const label = `${monthNames[parseInt(month) - 1]} ${year}`;

        const opt1 = document.createElement("option");
        opt1.value = mKey;
        opt1.textContent = label;
        startSel.appendChild(opt1);

        const opt2 = document.createElement("option");
        opt2.value = mKey;
        opt2.textContent = label;
        endSel.appendChild(opt2);
    });

    if (currentStart && sortedMonthKeys.includes(currentStart)) {
        startSel.value = currentStart;
    } else {
        const actualMonthsInState = Object.keys(state.months || {}).sort();
        startSel.value = actualMonthsInState.length ? actualMonthsInState[0] : sortedMonthKeys[0];
    }

    if (currentEnd && sortedMonthKeys.includes(currentEnd)) {
        endSel.value = currentEnd;
    } else {
        const actualMonthsInState = Object.keys(state.months || {}).sort();
        endSel.value = actualMonthsInState.length ? actualMonthsInState[actualMonthsInState.length - 1] : state.currentMonth;
    }
}

let periodMonthlyChartInstance = null;
let periodCategoryChartInstance = null;
let cachedPeriodRows = [];

function renderPeriodAnalysis() {
    // Populate month selectors only if they are not initialized
    populatePeriodMonthSelectors(false);

    const startMonth = document.getElementById("period-start-month")?.value;
    const endMonth = document.getElementById("period-end-month")?.value;
    const typeFilter = document.getElementById("period-type-filter")?.value || "all_expenses";
    const catFilter = document.getElementById("period-category-filter")?.value || "";

    if (!startMonth || !endMonth) return;

    const allMonths = Array.from(new Set([...Object.keys(state.months || {}), startMonth, endMonth])).sort();
    let selectedMonths = allMonths.filter(m => m >= startMonth && m <= endMonth);
    if (selectedMonths.length === 0) {
        selectedMonths = [startMonth];
    }

    let totalSpent = 0;
    let totalIncome = 0;
    const categoryTotals = {};
    const monthlyTotals = {};
    const consolidatedRows = [];

    selectedMonths.forEach(mKey => {
        const mData = state.months[mKey] || { income: [], fixedExpenses: [], varExpenses: [] };
        monthlyTotals[mKey] = { fixed: 0, var: 0, income: 0, total: 0 };

        // Process Fixed Expenses
        if (typeFilter === "all_expenses" || typeFilter === "fixedExpenses") {
            (mData.fixedExpenses || []).forEach(exp => {
                const amt = Number(exp.amount) || 0;
                if (!catFilter || matchesCategory(exp.desc, catFilter) || matchesCategory("Hogar", catFilter)) {
                    totalSpent += amt;
                    monthlyTotals[mKey].fixed += amt;
                    monthlyTotals[mKey].total += amt;
                    const cat = "Egresos Fijos";
                    categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
                    consolidatedRows.push({
                        month: mKey,
                        date: exp.date || `${mKey}-01`,
                        desc: exp.desc,
                        category: "Egreso Fijo",
                        payer: exp.payer,
                        split: exp.split,
                        amount: amt,
                        type: "fixed"
                    });
                }
            });
        }

        // Process Variable Expenses
        if (typeFilter === "all_expenses" || typeFilter === "varExpenses") {
            (mData.varExpenses || []).forEach(exp => {
                const amt = Number(exp.amount) || 0;
                const expCat = exp.category || "Otros";
                if (!catFilter || matchesCategory(expCat, catFilter)) {
                    totalSpent += amt;
                    monthlyTotals[mKey].var += amt;
                    monthlyTotals[mKey].total += amt;
                    categoryTotals[expCat] = (categoryTotals[expCat] || 0) + amt;
                    consolidatedRows.push({
                        month: mKey,
                        date: exp.date || `${mKey}-01`,
                        desc: exp.desc,
                        category: expCat,
                        payer: exp.payer,
                        split: exp.split,
                        amount: amt,
                        type: "var"
                    });
                }
            });
        }

        // Process Income
        if (typeFilter === "all_expenses" || typeFilter === "income") {
            (mData.income || []).forEach(inc => {
                const amt = Number(inc.amount) || 0;
                if (!catFilter || matchesCategory(inc.desc, catFilter)) {
                    totalIncome += amt;
                    monthlyTotals[mKey].income += amt;
                    if (typeFilter === "income") {
                        monthlyTotals[mKey].total += amt;
                    }
                    consolidatedRows.push({
                        month: mKey,
                        date: inc.date || `${mKey}-01`,
                        desc: inc.desc,
                        category: "Ingreso",
                        payer: inc.owner,
                        split: "shared",
                        amount: amt,
                        type: "income"
                    });
                }
            });
        }
    });

    const monthsCount = selectedMonths.length;
    const avgSpent = monthsCount > 0 ? (totalSpent / monthsCount) : 0;
    const netBalance = totalIncome - totalSpent;

    let topCatName = "-";
    let topCatAmount = 0;
    Object.entries(categoryTotals).forEach(([cat, val]) => {
        if (val > topCatAmount) {
            topCatAmount = val;
            topCatName = cat;
        }
    });

    const spentCard = document.getElementById("period-total-spent");
    if (spentCard) spentCard.textContent = formatVal(totalSpent);

    const spentDesc = document.getElementById("period-spent-months");
    if (spentDesc) spentDesc.textContent = `${monthsCount} mes(es) seleccionados (${startMonth} a ${endMonth})`;

    const avgCard = document.getElementById("period-avg-spent");
    if (avgCard) avgCard.textContent = formatVal(avgSpent);

    const countDesc = document.getElementById("period-months-count");
    if (countDesc) countDesc.textContent = `Promedio en ${monthsCount} mes(es)`;

    const incCard = document.getElementById("period-total-income");
    if (incCard) incCard.textContent = formatVal(totalIncome);

    const netDesc = document.getElementById("period-net-balance");
    if (netDesc) netDesc.textContent = `Balance neto del período: ${formatVal(netBalance)}`;

    const topCatCard = document.getElementById("period-top-category");
    if (topCatCard) topCatCard.textContent = topCatName;

    const topCatAmtDesc = document.getElementById("period-top-category-amount");
    if (topCatAmtDesc) topCatAmtDesc.textContent = topCatAmount > 0 ? `Total: ${formatVal(topCatAmount)}` : 'Sin registros';

    renderPeriodCharts(selectedMonths, monthlyTotals, categoryTotals);
    renderPeriodTable(consolidatedRows);
}

function renderPeriodCharts(selectedMonths, monthlyTotals, categoryTotals) {
    if (typeof Chart === 'undefined') return;

    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const labels = selectedMonths.map(m => {
        const [y, mNum] = m.split("-");
        return `${monthNames[parseInt(mNum) - 1]} ${y}`;
    });

    const ctxMonthly = document.getElementById("periodMonthlyChart")?.getContext("2d");
    if (ctxMonthly) {
        if (periodMonthlyChartInstance) periodMonthlyChartInstance.destroy();

        const fixedData = selectedMonths.map(m => monthlyTotals[m]?.fixed || 0);
        const varData = selectedMonths.map(m => monthlyTotals[m]?.var || 0);
        const incomeData = selectedMonths.map(m => monthlyTotals[m]?.income || 0);

        periodMonthlyChartInstance = new Chart(ctxMonthly, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Egresos Fijos', data: fixedData, backgroundColor: '#f43f5e', borderRadius: 4 },
                    { label: 'Egresos Variables', data: varData, backgroundColor: '#fbbf24', borderRadius: 4 },
                    { label: 'Ingresos', data: incomeData, backgroundColor: '#10b981', borderRadius: 4 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#94a3b8' } } },
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                }
            }
        });
    }

    const ctxCat = document.getElementById("periodCategoryChart")?.getContext("2d");
    if (ctxCat) {
        if (periodCategoryChartInstance) periodCategoryChartInstance.destroy();

        const catLabels = Object.keys(categoryTotals);
        const catData = Object.values(categoryTotals);

        periodCategoryChartInstance = new Chart(ctxCat, {
            type: 'doughnut',
            data: {
                labels: catLabels.length ? catLabels : ['Sin registros'],
                datasets: [{
                    data: catData.length ? catData : [1],
                    backgroundColor: ['#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#06b6d4', '#64748b'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'right', labels: { color: '#94a3b8' } } }
            }
        });
    }
}

function renderPeriodTable(rows) {
    if (rows) cachedPeriodRows = rows;
    const tbody = document.getElementById("table-period-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const searchVal = document.getElementById("search-period")?.value || "";
    const filteredRows = sortItemsByDate(cachedPeriodRows, 'desc').filter(item => {
        if (!searchVal.trim()) return true;
        const q = searchVal.toLowerCase();
        return (item.desc || '').toLowerCase().includes(q) ||
               (item.category || '').toLowerCase().includes(q) ||
               (item.month || '').toLowerCase().includes(q);
    });

    const countBadge = document.getElementById("search-count-period");
    if (countBadge) {
        countBadge.textContent = `${filteredRows.length} registros`;
    }

    if (filteredRows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No se encontraron registros en el período seleccionado.</td></tr>`;
        return;
    }

    filteredRows.forEach(item => {
        const tr = document.createElement("tr");
        const displayDate = formatDateDisplay(item.date || `${item.month}-01`);

        let payerLabel = item.payer === "member1" ? `<span class="badge badge-cris">${state.config.member1}</span>` : (item.payer === "member2" ? `<span class="badge badge-flor">${state.config.member2}</span>` : `<span class="badge badge-shared">Común</span>`);
        let splitLabel = item.split === "shared" ? `<span class="badge badge-shared">Común</span>` : (item.split === "member1" ? `<span class="badge badge-cris">Solo ${state.config.member1}</span>` : `<span class="badge badge-flor">Solo ${state.config.member2}</span>`);

        const isIncome = item.type === "income";
        const valColor = isIncome ? "color:var(--color-success);" : "color:var(--color-danger);";

        tr.innerHTML = `
            <td>${displayDate}</td>
            <td style="font-weight:600;">${item.desc}</td>
            <td><span class="badge" style="background:rgba(255,255,255,0.06); color:var(--text-secondary); border:1px solid rgba(255,255,255,0.1);">${item.category}</span></td>
            <td>${payerLabel}</td>
            <td>${splitLabel}</td>
            <td style="text-align: right; font-weight:700; ${valColor}">${isIncome ? '+' : '-'}${formatVal(item.amount)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function exportPeriodToExcel() {
    const startMonth = document.getElementById("period-start-month")?.value;
    const endMonth = document.getElementById("period-end-month")?.value;
    if (!cachedPeriodRows || cachedPeriodRows.length === 0) {
        showToast("No hay registros en el período para exportar.", "info");
        return;
    }

    if (typeof XLSX !== 'undefined') {
        const wb = XLSX.utils.book_new();
        const rows = cachedPeriodRows.map(item => ({
            "Mes / Fecha": formatDateDisplay(item.date || `${item.month}-01`),
            "Descripción": item.desc || "",
            "Categoría / Tipo": item.category || "",
            "Pagado Por": item.payer === "member1" ? (state.config.member1 || "Cris") : (item.payer === "member2" ? (state.config.member2 || "Flor") : "Común"),
            "Destino": item.split === "shared" ? "Común" : (item.split === "member1" ? `Solo ${state.config.member1 || "Cris"}` : `Solo ${state.config.member2 || "Flor"}`),
            "Monto": Number(item.amount) || 0
        }));

        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, `Periodo_${startMonth}_a_${endMonth}`);
        XLSX.writeFile(wb, `DuetBudget_Periodo_${startMonth}_a_${endMonth}.xlsx`);
        showToast(`Análisis del período ${startMonth} a ${endMonth} exportado a Excel!`, "success");
    }
}


