// app.js - Santi Money Tracker with Firebase Auth, Firestore, Plaid, and Ledger

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// =========================
// CONSTANTS – BACKEND ENDPOINTS
// =========================
const CREATE_LINK_URL = "https://createlinktoken-ot47thhs2a-uc.a.run.app";
const EXCHANGE_PUBLIC_TOKEN_URL =
  "https://exchangepublictoken-ot47thhs2a-uc.a.run.app";
const GET_ACCOUNTS_URL = "https://getplaidaccounts-ot47thhs2a-uc.a.run.app";
const GET_TRANSACTIONS_URL =
  "https://getplaidtransactions-ot47thhs2a-uc.a.run.app";

// =========================
// FIREBASE INSTANCES
// =========================

const auth = window.firebaseAuth;
const db = window.firebaseDb;
const GoogleAuthProviderCtor = window.GoogleAuthProvider;
const signInWithPopupFn = window.signInWithPopup;
const signInWithRedirectFn = window.signInWithRedirect;
const getRedirectResultFn = window.getRedirectResult;
const signOutFn = window.signOutFirebase;
const onAuthStateChangedFn = window.onFirebaseAuthStateChanged;

// =========================
// DOM REFS
// =========================

// Auth / layout
const authStatusEl = document.getElementById("auth-status");
const googleLoginBtn = document.getElementById("google-login");
const logoutBtn = document.getElementById("logout");
const authedArea = document.getElementById("authed-area");
const authExtraEl = document.querySelector(".auth-extra");
const profileBtn = document.getElementById("profile-btn");

// Tabs / views
const tabDashboard = document.getElementById("tab-dashboard");
const tabTransactions = document.getElementById("tab-transactions");
const tabLab = document.getElementById("tab-lab");
const tabBudget = document.getElementById("tab-budget");
const tabAccounting = document.getElementById("tab-accounting");

const viewDashboard = document.getElementById("view-dashboard");
const viewTransactions = document.getElementById("view-transactions");
const viewLab = document.getElementById("view-lab");
const viewBudget = document.getElementById("view-budget");
const viewAccounting = document.getElementById("view-accounting");
const viewProfile = document.getElementById("view-profile");

// Profile info
const profileEmailEl = document.getElementById("profile-email");
const profileUidEl = document.getElementById("profile-uid");

// Summary (capital power)
const capitalTotalEl = document.getElementById("capital-total");
const capitalLiquidEl = document.getElementById("capital-liquid");
const capitalCreditEl = document.getElementById("capital-credit");
const capitalSolidEl = document.getElementById("capital-solid");
const capitalNetEl = document.getElementById("capital-net");
const connectBankBtn = document.getElementById("connect-bank");

// Accounts snapshot
const accountsListEl = document.getElementById("accounts-list");
const accountsTotalEl = document.getElementById("accounts-total");
const refreshAccountsBtn = document.getElementById("refresh-accounts");

// Manual tracker (simple "plays")
const form = document.getElementById("tx-form");
const labelInput2 = document.getElementById("label");
const amountInput2 = document.getElementById("amount");
const typeInput2 = document.getElementById("type");
const txListEl = document.getElementById("tx-list");

// Budget panel
const budgetListEl = document.getElementById("budget-list");

// Plaid transactions list
const plaidTxListEl = document.getElementById("plaid-tx-list");
const refreshPlaidTxBtn = document.getElementById("refresh-plaid-tx");

// Accounting view
const coaListEl = document.getElementById("coa-list");
const trialBalanceEl = document.getElementById("trial-balance");

// Email / password auth
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const emailSignupBtn = document.getElementById("email-signup");
const emailLoginBtn = document.getElementById("email-login");

// Phone auth
const phoneInput = document.getElementById("phone");
const sendBtn = document.getElementById("send");
const codeInput = document.getElementById("code");
const verifyBtn = document.getElementById("verify");

// Ledger (Transactions view)
const ledgerForm = document.getElementById("ledger-form");
const ledgerDateInput = document.getElementById("ledger-date");
const ledgerLabelInput = document.getElementById("ledger-label");
const ledgerAmountInput = document.getElementById("ledger-amount");
const ledgerTypeInput = document.getElementById("ledger-type");
const ledgerFromInput = document.getElementById("ledger-from");
const ledgerToInput = document.getElementById("ledger-to");
const ledgerPlatformInput = document.getElementById("ledger-platform");
const ledgerTagsInput = document.getElementById("ledger-tags");
const ledgerNoteInput = document.getElementById("ledger-note");

const ledgerSourceFilter = document.getElementById("ledger-source-filter");
const ledgerTypeFilter = document.getElementById("ledger-type-filter");
const ledgerSortSelect = document.getElementById("ledger-sort");
const ledgerSearchInput = document.getElementById("ledger-search");
const ledgerListEl = document.getElementById("ledger-list");

// =========================
// GLOBAL STATE
// =========================

let currentUser = null;

// manual "plays" on dashboard
let transactions = [];

// manual ledger entries (Transactions tab)
let ledgerEntries = [];

let netWorth = 0; // manual net worth (from "plays")
let plaidAccountsCache = [];
let plaidTransactionsCache = [];

const googleProvider = new GoogleAuthProviderCtor();

// Simple budgets (can move to Firestore later)
const defaultBudgets = [
  { id: "housing", name: "Housing", limit: 1000 },
  { id: "food", name: "Food", limit: 600 },
  { id: "transport", name: "Transport", limit: 300 },
  { id: "fun", name: "Fun", limit: 400 },
  { id: "other", name: "Other", limit: 500 },
];

// =========================
// HELPERS
// =========================

function formatMoney(value) {
  const v = Number(value) || 0;
  return `$${Math.abs(v).toFixed(2)}`;
}

async function callFunction(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Function error: ${res.status} ${txt}`);
  }

  return res.json();
}

function showView(viewName) {
  const views = [
    { name: "dashboard", el: viewDashboard, tab: tabDashboard },
    { name: "transactions", el: viewTransactions, tab: tabTransactions },
    { name: "lab", el: viewLab, tab: tabLab },
    { name: "budget", el: viewBudget, tab: tabBudget },
    { name: "accounting", el: viewAccounting, tab: tabAccounting },
    { name: "profile", el: viewProfile, tab: null },
  ];

  views.forEach((v) => {
    if (!v.el) return;
    v.el.style.display = v.name === viewName ? "block" : "none";
  });

  [tabDashboard, tabTransactions, tabLab, tabBudget, tabAccounting].forEach(
    (tab) => {
      if (!tab) return;
      tab.classList.remove("nav-tab-active");
    }
  );

  const active = views.find((v) => v.name === viewName);
  if (active && active.tab) {
    active.tab.classList.add("nav-tab-active");
  }
}

// =========================
// USER PROFILE + SESSION
// =========================

async function ensureUserDoc(user) {
  if (!user) return false;

  const providers = (user.providerData || []).map((p) => p.providerId);
  const allowed =
    providers.includes("google.com") || providers.includes("password");

  if (!allowed) {
    alert(
      "Phone-only sign-ins can't create a profile yet. Please log in with Google or email."
    );
    await signOutFn(auth);
    return false;
  }

  const userDocRef = doc(db, "users", user.uid);
  const snap = await getDoc(userDocRef);

  if (!snap.exists()) {
    await setDoc(userDocRef, {
      profile: {
        uid: user.uid,
        email: user.email || null,
        phoneNumber: user.phoneNumber || null,
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      },
      transactions: [],
      manual: { ledger: [] },
    });
  } else {
    await setDoc(
      userDocRef,
      {
        profile: {
          uid: user.uid,
          email: user.email || null,
          phoneNumber: user.phoneNumber || null,
          lastLoginAt: serverTimestamp(),
        },
      },
      { merge: true }
    );
  }

  return true;
}

onAuthStateChangedFn(auth, async (user) => {
  currentUser = user || null;

  if (user) {
    const displayLabel = user.email || user.phoneNumber || "User";
    authStatusEl.textContent = `Signed in`;
    authStatusEl.title = displayLabel;
    googleLoginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    authedArea.style.display = "block";
    if (authExtraEl) authExtraEl.style.display = "none";
    if (profileBtn) {
      profileBtn.style.display = "inline-flex";
      profileBtn.textContent = user.email?.split("@")[0] || "Profile";
    }

    if (profileEmailEl)
      profileEmailEl.textContent = `Email: ${user.email || "—"}`;
    if (profileUidEl) profileUidEl.textContent = `UID: ${user.uid}`;

    const ok = await ensureUserDoc(user);
    if (!ok) return;

    await loadState();
    await loadAccounts();
    await loadPlaidTransactions();
    showView("dashboard");
  } else {
    authStatusEl.textContent = "Not signed in";
    googleLoginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    authedArea.style.display = "none";
    if (authExtraEl) authExtraEl.style.display = "flex";
    if (profileBtn) profileBtn.style.display = "none";

    transactions = [];
    ledgerEntries = [];
    netWorth = 0;
    plaidAccountsCache = [];
    plaidTransactionsCache = [];
    renderAll();
    renderCapitalPower();
    renderAccountingView();
    renderLedger();
    if (accountsListEl) accountsListEl.innerHTML = "";
    if (accountsTotalEl) accountsTotalEl.textContent = "Total (Banks): $0.00";
    if (plaidTxListEl) plaidTxListEl.innerHTML = "";
  }
});

// =========================
// AUTH EVENTS
// =========================

if (googleLoginBtn) {
  googleLoginBtn.addEventListener("click", async () => {
    try {
      await signInWithPopupFn(auth, googleProvider);
    } catch (err) {
      console.error("Google sign-in error:", err);
      if (err?.code === "auth/popup-blocked") {
        await signInWithRedirectFn(auth, googleProvider);
        return;
      }
      alert("Google sign-in failed. Enable popups and try again.");
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOutFn(auth);
    } catch (err) {
      console.error("Sign-out error:", err);
    }
  });
}

if (profileBtn) {
  profileBtn.addEventListener("click", () => {
    if (!currentUser) return;
    showView("profile");
  });
}

// Tabs
if (tabDashboard) {
  tabDashboard.addEventListener("click", () => showView("dashboard"));
}
if (tabTransactions) {
  tabTransactions.addEventListener("click", () => showView("transactions"));
}
if (tabLab) {
  tabLab.addEventListener("click", () => showView("lab"));
}
if (tabBudget) {
  tabBudget.addEventListener("click", () => showView("budget"));
}
if (tabAccounting) {
  tabAccounting.addEventListener("click", () => showView("accounting"));
}

// =========================
// EMAIL / PASSWORD AUTH
// =========================

if (emailSignupBtn) {
  emailSignupBtn.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      alert("Enter email and password.");
      return;
    }

    try {
      await createUserWithEmailAndPassword(auth, email, password);
      alert("Account created and logged in.");
    } catch (err) {
      console.error("Email signup error:", err);
      alert(err.message || "Email sign-up failed.");
    }
  });
}

if (emailLoginBtn) {
  emailLoginBtn.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      alert("Enter email and password.");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      console.error("Email login error:", err);
      alert(err.message || "Email login failed.");
    }
  });
}

// =========================
// PHONE AUTH
// =========================

let recaptchaVerifier = null;
let confirmationResultGlobal = null;

function setupRecaptcha() {
  if (recaptchaVerifier) return;

  recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
    size: "invisible",
    callback: (response) => {
      console.log("reCAPTCHA resolved:", response);
    },
  });

  window.recaptchaVerifier = recaptchaVerifier;
}

if (sendBtn) {
  sendBtn.addEventListener("click", async () => {
    const phoneNumber = phoneInput.value.trim();
    if (!phoneNumber) {
      alert("Enter a phone number.");
      return;
    }

    try {
      setupRecaptcha();
      confirmationResultGlobal = await signInWithPhoneNumber(
        auth,
        phoneNumber,
        recaptchaVerifier
      );
      alert("Code sent. Check your SMS.");
    } catch (err) {
      console.error("Phone sign-in error:", err);
      alert(err.message || "Failed to send code.");
    }
  });
}

if (verifyBtn) {
  verifyBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    if (!code) {
      alert("Enter the verification code.");
      return;
    }

    if (!confirmationResultGlobal) {
      alert("Send the code first.");
      return;
    }

    try {
      await confirmationResultGlobal.confirm(code);
    } catch (err) {
      console.error("Code verify error:", err);
      alert(err.message || "Failed to verify code.");
    }
  });
}

// =========================
// FIRESTORE – MANUAL STATE
// =========================

async function loadState() {
  if (!currentUser) {
    transactions = [];
    ledgerEntries = [];
    netWorth = 0;
    renderAll();
    renderLedger();
    return;
  }

  const userDocRef = doc(db, "users", currentUser.uid);

  try {
    const snap = await getDoc(userDocRef);

    if (snap.exists()) {
      const data = snap.data() || {};
      transactions = Array.isArray(data.transactions)
        ? data.transactions
        : [];
      ledgerEntries =
        data.manual && Array.isArray(data.manual.ledger)
          ? data.manual.ledger
          : [];
    } else {
      transactions = [];
      ledgerEntries = [];
      await setDoc(
        userDocRef,
        { transactions: [], manual: { ledger: [] } },
        { merge: true }
      );
    }
  } catch (err) {
    console.error("Failed to load state from Firestore:", err);
    transactions = [];
    ledgerEntries = [];
  }

  renderAll();
  renderLedger();
}

async function saveState() {
  if (!currentUser) return;

  const userDocRef = doc(db, "users", currentUser.uid);

  try {
    await setDoc(
      userDocRef,
      {
        transactions,
        manual: {
          ledger: ledgerEntries,
        },
      },
      { merge: true }
    );
  } catch (err) {
    console.error("Failed to save state to Firestore:", err);
  }
}

function computeManualNetWorth() {
  netWorth = transactions.reduce((sum, tx) => {
    const amt = Number(tx.amount) || 0;
    const positive = tx.type === "asset" || tx.type === "income";
    return sum + (positive ? amt : -amt);
  }, 0);
}

function renderAll() {
  // dashboard manual breakdown
  if (txListEl) {
    computeManualNetWorth();

    txListEl.innerHTML = "";
    transactions.forEach((tx) => {
      const li = document.createElement("li");
      li.className = "tx-row";

      const isPositive = tx.type === "asset" || tx.type === "income";
      const sign = isPositive ? "+" : "-";
      const amountClass = `tx-amount ${isPositive ? "pos" : "neg"}`;

      li.innerHTML = `
        <span class="tx-label">${tx.label}</span>
        <span class="tx-type">${tx.type}</span>
        <span class="${amountClass}">${sign}${formatMoney(
        Number(tx.amount) || 0
      )}</span>
      `;

      txListEl.appendChild(li);
    });

    if (!transactions.length) {
      txListEl.innerHTML =
        "<li class='tx-row'><span class='tx-label'>No manual items yet.</span></li>";
    }
  }

  renderCapitalPower();
  renderBudget();
  renderAccountingView();
}

// handle new manual transaction (dashboard)
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const label = labelInput2.value.trim();
    const amount = Number(amountInput2.value);
    const type = typeInput2.value;

    if (!currentUser) {
      alert("You must be logged in to save transactions.");
      return;
    }

    if (!label || isNaN(amount)) {
      alert("Enter a label and a valid amount.");
      return;
    }

    transactions.push({
      id: Date.now(),
      label,
      amount,
      type,
    });

    renderAll();
    await saveState();

    form.reset();
    typeInput2.value = "asset";
  });
}

// =========================
// PLAID ACCOUNTS
// =========================

async function loadAccounts() {
  if (!currentUser || !accountsListEl || !accountsTotalEl) return;

  accountsListEl.innerHTML = "<li>Loading accounts...</li>";

  try {
    const data = await callFunction(GET_ACCOUNTS_URL, {
      uid: currentUser.uid,
    });

    const accounts = Array.isArray(data.accounts) ? data.accounts : [];

    plaidAccountsCache = accounts;

    accountsListEl.innerHTML = "";
    let total = 0;

    accounts.forEach((acc) => {
      const bal = Number(acc.balance) || 0;

      // only asset-ish accounts for this snapshot
      const isAssetType = acc.type !== "credit" && acc.type !== "loan";

      if (isAssetType) total += bal;

      const li = document.createElement("li");
      li.className = "account-row";
      li.innerHTML = `
        <span class="account-name">
          ${acc.name}
          ${acc.subtype ? ` (${acc.subtype})` : ""}
          ${acc.mask ? ` ••••${acc.mask}` : ""}
        </span>
        <span class="account-balance">${formatMoney(bal)}</span>
      `;

      accountsListEl.appendChild(li);
    });

    if (!accounts.length) {
      accountsListEl.innerHTML = "<li>No linked accounts yet.</li>";
    }

    accountsTotalEl.textContent = `Total (Banks): ${formatMoney(total)}`;

    renderCapitalPower();
    renderAccountingView();
  } catch (err) {
    console.error("loadAccounts error:", err);
    accountsListEl.innerHTML = "<li>Failed to load accounts.</li>";
    accountsTotalEl.textContent = "Total (Banks): $0.00";
  }
}

if (refreshAccountsBtn) {
  refreshAccountsBtn.addEventListener("click", async () => {
    if (!currentUser) {
      alert("Log in first.");
      return;
    }
    await loadAccounts();
  });
}

// =========================
// PLAID LINK
// =========================

if (connectBankBtn) {
  connectBankBtn.addEventListener("click", async () => {
    if (!currentUser) {
      alert("Log in first.");
      return;
    }

    try {
      const { link_token } = await callFunction(CREATE_LINK_URL, {
        uid: currentUser.uid,
      });

      const handler = Plaid.create({
        token: link_token,
        onSuccess: async (public_token, metadata) => {
          try {
            await callFunction(EXCHANGE_PUBLIC_TOKEN_URL, {
              uid: currentUser.uid,
              public_token,
            });
            alert("Bank linked successfully (sandbox).");
            await loadAccounts();
            await loadPlaidTransactions();
          } catch (err) {
            console.error("exchangePublicToken error:", err);
            alert("Failed to save Plaid link.");
          }
        },
        onExit: (err, metadata) => {
          if (err) console.error("Plaid exit error:", err);
        },
      });

      handler.open();
    } catch (err) {
      console.error("createLinkToken error:", err);
      alert("Failed to start bank connection.");
    }
  });
}

// =========================
// PLAID TRANSACTIONS
// =========================

async function loadPlaidTransactions() {
  if (!currentUser || !plaidTxListEl) return;

  plaidTxListEl.innerHTML = "<li>Loading bank activity...</li>";

  try {
    const data = await callFunction(GET_TRANSACTIONS_URL, {
      uid: currentUser.uid,
    });

    const txs = Array.isArray(data.transactions) ? data.transactions : [];

    plaidTransactionsCache = txs;

    plaidTxListEl.innerHTML = "";

    txs.forEach((tx) => {
      const amountNum = Number(tx.amount) || 0;
      const isOutflow = amountNum > 0; // Plaid: positive usually = money out
      const sign = isOutflow ? "-" : "+";
      const li = document.createElement("li");
      li.className = "tx-row plaid-row";
      li.innerHTML = `
        <span class="tx-label">${tx.name || "Transaction"}</span>
        <span class="tx-type">${tx.date || ""}</span>
        <span class="tx-amount ${
          isOutflow ? "neg" : "pos"
        }">${sign}${formatMoney(Math.abs(amountNum))}</span>
      `;
      plaidTxListEl.appendChild(li);
    });

    if (!txs.length) {
      plaidTxListEl.innerHTML =
        "<li class='tx-row plaid-row'><span class='tx-label'>No recent bank transactions.</span></li>";
    }

    renderLedger();
  } catch (err) {
    console.error("loadPlaidTransactions error:", err);
    plaidTxListEl.innerHTML =
      "<li>Failed to load bank transactions.</li>";
  }
}

if (refreshPlaidTxBtn) {
  refreshPlaidTxBtn.addEventListener("click", async () => {
    if (!currentUser) {
      alert("Log in first.");
      return;
    }
    await loadPlaidTransactions();
  });
}

// =========================
// CAPITAL POWER CALC
// =========================

function renderCapitalPower() {
  if (
    !capitalTotalEl ||
    !capitalLiquidEl ||
    !capitalCreditEl ||
    !capitalSolidEl ||
    !capitalNetEl
  )
    return;

  // manual net worth (from computeManualNetWorth)
  const manualNet = netWorth;

  let plaidAssetTotal = 0;
  let plaidDebtTotal = 0;
  let creditPower = 0;

  plaidAccountsCache.forEach((acc) => {
    const bal = Number(acc.balance) || 0;

    if (acc.type === "credit" || acc.type === "loan") {
      plaidDebtTotal += bal;

      const limit = Number(acc.creditLimit || 0);
      if (limit > 0) {
        const available = Math.max(limit - bal, 0);
        creditPower += available;
      }
    } else {
      plaidAssetTotal += bal;
    }
  });

  let manualAssets = 0;
  let manualLiabs = 0;

  transactions.forEach((tx) => {
    const amt = Number(tx.amount) || 0;
    if (tx.type === "asset") manualAssets += amt;
    if (tx.type === "liability") manualLiabs += amt;
  });

  const liquidPower = plaidAssetTotal; // banks only for now
  const solidPower = manualAssets; // treat manual assets as "solid"
  const capitalTotal = liquidPower + creditPower;
  const netWorthCombined = manualNet + plaidAssetTotal - plaidDebtTotal;

  capitalTotalEl.textContent = formatMoney(capitalTotal);
  capitalLiquidEl.textContent = formatMoney(liquidPower);
  capitalCreditEl.textContent = formatMoney(creditPower);
  capitalSolidEl.textContent = formatMoney(solidPower);
  capitalNetEl.textContent = formatMoney(netWorthCombined);
}

// =========================
// BUDGET PANEL
// =========================

function computeBudgetUsage() {
  const usage = {};
  defaultBudgets.forEach((b) => (usage[b.id] = 0));

  transactions.forEach((tx) => {
    if (tx.type !== "expense") return;
    const amt = Math.abs(Number(tx.amount) || 0);
    const label = (tx.label || "").toLowerCase();

    let bucket = "other";
    if (label.includes("rent") || label.includes("mortgage")) {
      bucket = "housing";
    } else if (
      label.includes("food") ||
      label.includes("groc") ||
      label.includes("restaurant") ||
      label.includes("chipotle")
    ) {
      bucket = "food";
    } else if (
      label.includes("gas") ||
      label.includes("uber") ||
      label.includes("lyft")
    ) {
      bucket = "transport";
    } else if (
      label.includes("club") ||
      label.includes("party") ||
      label.includes("bar") ||
      label.includes("movie")
    ) {
      bucket = "fun";
    }

    if (!usage[bucket]) usage[bucket] = 0;
    usage[bucket] += amt;
  });

  return usage;
}

function renderBudget() {
  if (!budgetListEl) return;

  const usage = computeBudgetUsage();

  budgetListEl.innerHTML = "";
  defaultBudgets.forEach((b) => {
    const used = usage[b.id] || 0;
    const pct = b.limit > 0 ? Math.min((used / b.limit) * 100, 160) : 0;
    const over = used > b.limit;

    const li = document.createElement("li");
    li.className = `budget-row ${over ? "budget-over" : ""}`;
    li.innerHTML = `
      <div class="budget-header">
        <span class="budget-name">${b.name}</span>
        <span class="budget-amounts">${formatMoney(
          used
        )} / ${formatMoney(b.limit)}</span>
      </div>
      <div class="budget-bar">
        <div class="budget-bar-fill" style="width:${pct}%;"></div>
      </div>
    `;

    budgetListEl.appendChild(li);
  });
}

// =========================
// ACCOUNTING VIEW
// =========================

function renderAccountingView() {
  if (!coaListEl || !trialBalanceEl) return;

  // Chart of Accounts from Plaid
  coaListEl.innerHTML = "";
  const accounts = plaidAccountsCache;

  if (!accounts.length) {
    coaListEl.innerHTML =
      "<li>No linked accounts yet. Connect a bank to see accounting view.</li>";
  } else {
    accounts.forEach((acc) => {
      const typeLabel =
        acc.type === "credit" || acc.type === "loan" ? "Liability" : "Asset";

      const li = document.createElement("li");
      li.className = "account-row";
      li.innerHTML = `
        <span class="account-name">
          [${typeLabel}] ${acc.name}
          ${acc.subtype ? ` (${acc.subtype})` : ""}
        </span>
        <span class="account-balance">${formatMoney(acc.balance)}</span>
      `;
      coaListEl.appendChild(li);
    });
  }

  // Simple trial balance: Assets vs Liabilities from Plaid + manual net
  let plaidAssets = 0;
  let plaidLiabs = 0;

  accounts.forEach((acc) => {
    const bal = Number(acc.balance) || 0;
    if (acc.type === "credit" || acc.type === "loan") {
      plaidLiabs += bal;
    } else {
      plaidAssets += bal;
    }
  });

  trialBalanceEl.innerHTML = `
    <p>Plaid Assets: ${formatMoney(plaidAssets)}</p>
    <p>Plaid Liabilities: ${formatMoney(plaidLiabs)}</p>
    <p>Manual Net (plays): ${formatMoney(netWorth)}</p>
    <p style="margin-top:6px;">Combined Net (approx): ${formatMoney(
      plaidAssets - plaidLiabs + netWorth
    )}</p>
  `;
}

// =========================
// LEDGER – UNIFIED TRANSACTIONS VIEW
// =========================

function buildUnifiedLedgerRows() {
  const rows = [];

  // 1) Manual ledger entries (from the Transactions tab form)
  for (const entry of ledgerEntries) {
    rows.push({
      id: entry.id,
      source: "manual",
      sourceLabel: "Manual",
      date: entry.date || "",
      label: entry.label || "",
      amount: Number(entry.amount) || 0,
      type: entry.type || "adjustment",
      fromAccount: entry.fromAccount || "",
      toAccount: entry.toAccount || "",
      platform: entry.platform || "",
      tags: entry.tags || "",
      note: entry.note || "",
    });
  }

  // 2) Bank / Plaid transactions
  for (const tx of plaidTransactionsCache) {
    const amountNum = Number(tx.amount) || 0;
    // In Plaid sandbox, positive = money out, negative = refund
    const isOutflow = amountNum > 0;

    rows.push({
      id: tx.transactionId || `plaid-${Math.random().toString(36).slice(2, 8)}`,
      source: "bank",
      sourceLabel: "Bank",
      date: tx.date || "",
      label: tx.name || "",
      amount: isOutflow ? -amountNum : amountNum * -1, // normalize: negative = outflow, positive = inflow
      type: isOutflow ? "expense" : "income",
      fromAccount: isOutflow ? "Bank" : "",
      toAccount: !isOutflow ? "Bank" : "",
      platform: "Plaid",
      tags: Array.isArray(tx.category) ? tx.category.join(", ") : "",
      note: "",
    });
  }

  return rows;
}

function renderLedger() {
  if (!ledgerListEl) return;

  let rows = buildUnifiedLedgerRows();

  const srcFilter = ledgerSourceFilter?.value || "all";
  const typeFilter = ledgerTypeFilter?.value || "all";
  const search = (ledgerSearchInput?.value || "").toLowerCase().trim();
  const sortMode = ledgerSortSelect?.value || "date-desc";

  if (srcFilter !== "all") {
    rows = rows.filter((r) => r.source === srcFilter);
  }

  if (typeFilter !== "all") {
    rows = rows.filter((r) => r.type === typeFilter);
  }

  if (search) {
    rows = rows.filter((r) => {
      const blob = `${r.label} ${r.fromAccount} ${r.toAccount} ${r.platform} ${r.tags}`.toLowerCase();
      return blob.includes(search);
    });
  }

  rows.sort((a, b) => {
    if (sortMode === "date-asc" || sortMode === "date-desc") {
      const da = a.date || "";
      const db = b.date || "";
      if (da === db) return 0;
      const cmp = da < db ? -1 : 1;
      return sortMode === "date-asc" ? cmp : -cmp;
    }

    if (sortMode === "amount-asc" || sortMode === "amount-desc") {
      const cmp = (a.amount || 0) - (b.amount || 0);
      return sortMode === "amount-asc" ? cmp : -cmp;
    }

    return 0;
  });

  ledgerListEl.innerHTML = "";

  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "ledger-row empty-state";
    li.textContent = "No transactions in this view yet.";
    ledgerListEl.appendChild(li);
    return;
  }

  for (const row of rows) {
    const li = document.createElement("li");
    li.className = "ledger-row";

    const isPositive = row.amount > 0;
    const isNegative = row.amount < 0;
    const sign = row.amount === 0 ? "" : isPositive ? "+" : "-";
    const amountDisplay = formatMoney(Math.abs(row.amount));

    li.innerHTML = `
      <div class="ledger-main">
        <div class="ledger-left">
          <div class="ledger-label">${row.label || "(no label)"}</div>
          <div class="ledger-meta">
            <span>${row.date || "—"}</span>
            ${
              row.fromAccount || row.toAccount
                ? `<span>${row.fromAccount || "?"} → ${
                    row.toAccount || "?"
                  }</span>`
                : ""
            }
            ${row.platform ? `<span>${row.platform}</span>` : ""}
            ${
              row.tags
                ? `<span class="tag-pill">${row.tags}</span>`
                : ""
            }
          </div>
        </div>
        <div class="ledger-right">
          <span class="ledger-source-pill ledger-source-${row.source}">
            ${row.sourceLabel}
          </span>
          <span class="ledger-amount ${
            isPositive ? "pos" : isNegative ? "neg" : ""
          }">
            ${sign}${amountDisplay}
          </span>
        </div>
      </div>
      ${
        row.note
          ? `<div class="ledger-note">${row.note}</div>`
          : ""
      }
    `;

    ledgerListEl.appendChild(li);
  }
}

// Ledger form + filters
if (ledgerForm) {
  ledgerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) {
      alert("You must be logged in to save to the ledger.");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const date = ledgerDateInput.value || today;
    const label = ledgerLabelInput.value.trim();
    const amount = Number(ledgerAmountInput.value || 0);
    const type = ledgerTypeInput.value || "expense";

    if (!label || !amount) return;

    const entry = {
      id: `ldg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date,
      label,
      amount,
      type,
      fromAccount: ledgerFromInput.value.trim(),
      toAccount: ledgerToInput.value.trim(),
      platform: ledgerPlatformInput.value.trim(),
      tags: ledgerTagsInput.value.trim(),
      note: ledgerNoteInput.value.trim(),
      createdAt: Date.now(),
    };

    ledgerEntries.unshift(entry);

    ledgerForm.reset();
    ledgerDateInput.value = today;

    renderLedger();
    await saveState();
  });

  // set default date once
  if (!ledgerDateInput.value) {
    ledgerDateInput.value = new Date().toISOString().slice(0, 10);
  }
}

[ledgerSourceFilter, ledgerTypeFilter, ledgerSortSelect].forEach((el) => {
  if (!el) return;
  el.addEventListener("change", () => renderLedger());
});

if (ledgerSearchInput) {
  ledgerSearchInput.addEventListener("input", () => renderLedger());
}

// =========================
// GOOGLE REDIRECT ERROR HANDLER
// =========================

getRedirectResultFn(auth).catch((err) => {
  console.error("Google redirect error:", err);
});
