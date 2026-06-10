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

// Ensure the current month exists in the database
function ensureCurrentMonthExists() {
    if (!state.months[state.currentMonth]) {
        state.months[state.currentMonth] = {
            income: [],
            fixedExpenses: [],
            varExpenses: [],
            savings: []
        };
        // Clone savings goals from previous month if available, so they don't have to re-enter targets
        const monthsList = Object.keys(state.months).sort();
        const currentIndex = monthsList.indexOf(state.currentMonth);
        if (currentIndex > 0) {
            const prevMonthKey = monthsList[currentIndex - 1];
            const prevMonthData = state.months[prevMonthKey];
            if (prevMonthData && prevMonthData.savings) {
                // Copy goals
                state.months[state.currentMonth].savings = JSON.parse(JSON.stringify(prevMonthData.savings));
            }
        }
        saveState();
    }
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
        case "settings":
            titleEl.textContent = "Configuración";
            descEl.textContent = "Preferencias, división de cuentas y administración de datos.";
            break;
    }

    // Trigger recalculation and rendering to ensure dashboard is always up to date
    if (tabId === "dashboard") {
        renderApp();
        setTimeout(renderCharts, 50);
    }
}

// --- RENDER FUNCTIONS ---
function renderApp() {
    ensureCurrentMonthExists();
    
    // Update config displays
    updateConfigUI();
    
    // Render Month tables & totals
    const currentData = state.months[state.currentMonth];
    
    renderIncome(currentData.income);
    renderFixedExpenses(currentData.fixedExpenses);
    renderVarExpenses(currentData.varExpenses);
    renderSavings(currentData.savings);
    
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

// Render Income Tab Table
function renderIncome(incomeList) {
    const tbody = document.getElementById("table-income-body");
    tbody.innerHTML = "";
    
    if (incomeList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No hay ingresos registrados para este mes.</td></tr>`;
        return;
    }
    
    incomeList.forEach(inc => {
        const tr = document.createElement("tr");
        
        let ownerLabel = "";
        if (inc.owner === "member1") ownerLabel = `<span class="badge badge-cris">${state.config.member1}</span>`;
        else if (inc.owner === "member2") ownerLabel = `<span class="badge badge-flor">${state.config.member2}</span>`;
        else ownerLabel = `<span class="badge badge-shared">Compartido</span>`;
        
        tr.innerHTML = `
            <td>${inc.desc}</td>
            <td>${ownerLabel}</td>
            <td style="text-align: right; font-weight:700;">${formatVal(inc.amount)}</td>
            <td style="text-align: center;">
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
    
    if (fixedList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No hay egresos fijos registrados.</td></tr>`;
        return;
    }
    
    fixedList.forEach(exp => {
        const tr = document.createElement("tr");
        
        let payerLabel = exp.payer === "member1" ? `<span class="badge badge-cris">${state.config.member1}</span>` : `<span class="badge badge-flor">${state.config.member2}</span>`;
        
        let splitLabel = "";
        if (exp.split === "shared") splitLabel = `<span class="badge badge-shared">Común</span>`;
        else if (exp.split === "member1") splitLabel = `<span class="badge badge-cris">Solo ${state.config.member1}</span>`;
        else splitLabel = `<span class="badge badge-flor">Solo ${state.config.member2}</span>`;
        
        tr.innerHTML = `
            <td>${exp.desc}</td>
            <td>${payerLabel}</td>
            <td>${splitLabel}</td>
            <td style="text-align: right; font-weight:700; color:var(--color-danger);">${formatVal(exp.amount)}</td>
            <td style="text-align: center;">
                <button class="btn btn-danger" style="padding: 0.35rem 0.65rem; font-size: 0.75rem;" onclick="deleteItem('fixedExpenses', '${exp.id}')">
                    Borrar
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Render Variable Expenses Tab Table
function renderVarExpenses(varList) {
    const tbody = document.getElementById("table-var-body");
    tbody.innerHTML = "";
    
    if (varList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No hay egresos variables registrados.</td></tr>`;
        return;
    }
    
    varList.forEach(exp => {
        const tr = document.createElement("tr");
        
        let payerLabel = exp.payer === "member1" ? `<span class="badge badge-cris">${state.config.member1}</span>` : `<span class="badge badge-flor">${state.config.member2}</span>`;
        
        let splitLabel = "";
        if (exp.split === "shared") splitLabel = `<span class="badge badge-shared">Común</span>`;
        else if (exp.split === "member1") splitLabel = `<span class="badge badge-cris">Solo ${state.config.member1}</span>`;
        else splitLabel = `<span class="badge badge-flor">Solo ${state.config.member2}</span>`;
        
        tr.innerHTML = `
            <td>${exp.desc}</td>
            <td><span class="badge" style="background:rgba(255,255,255,0.04); color:var(--text-secondary); border:1px solid rgba(255,255,255,0.05);">${exp.category}</span></td>
            <td>${payerLabel}</td>
            <td>${splitLabel}</td>
            <td style="text-align: right; font-weight:700; color:var(--color-danger);">${formatVal(exp.amount)}</td>
            <td style="text-align: center;">
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
    document.querySelectorAll(".nav-links .nav-item").forEach(item => {
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
        
        if (desc && amount > 0) {
            state.months[state.currentMonth].income.push({
                id: 'inc-' + Date.now(),
                desc,
                owner,
                amount
            });
            saveState();
            renderApp();
            document.getElementById("form-income").reset();
        }
    });
    
    // Add Fixed Expense
    document.getElementById("form-expenses-fixed").addEventListener("submit", (e) => {
        e.preventDefault();
        const desc = document.getElementById("fixed-desc").value.trim();
        const payer = document.getElementById("fixed-payer").value;
        const split = document.getElementById("fixed-split").value;
        const amount = Number(document.getElementById("fixed-amount").value);
        
        if (desc && amount > 0) {
            state.months[state.currentMonth].fixedExpenses.push({
                id: 'fix-' + Date.now(),
                desc,
                payer,
                split,
                amount
            });
            saveState();
            renderApp();
            document.getElementById("form-expenses-fixed").reset();
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
        
        if (desc && amount > 0) {
            state.months[state.currentMonth].varExpenses.push({
                id: 'var-' + Date.now(),
                desc,
                category,
                payer,
                split,
                amount
            });
            saveState();
            renderApp();
            document.getElementById("form-expenses-var").reset();
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


