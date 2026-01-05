let step = 1;

const APP_VERSION = "v0.3.0";

let answers = {
  reminders: {
    before7: true,
    before3: true,
    onDue: true
  },
  taxYear: new Date().getFullYear()
};




// ===== TAX DUE DATE CONFIG (PH) =====
const TAX_DUE_DATES = {
  vat: { form: "2550Q", months: [4, 7, 10, 1], day: 25 },
  percentage: { form: "2551Q", months: [4, 7, 10, 1], day: 25 },
  quarterlyIncome: { form: "1701Q", months: [5, 8, 11], day: 15 },
  annualIncome: { form: "1701", month: 4, day: 15 }
};

// ===== TAX RULE ENGINE (LOCKED / AUDITABLE) =====
const TAX_RULES = {
  eightPercent: {
    key: "eightPercent",
    label: "8% income tax option",

    rate: 0.08,
    requiresDeclaration: true,
    excludes: ["2551Q"],

    eligible: a =>
      a.hasBIR &&
      !a.over3M &&
      (a.online || a.hasStore) &&
      a.useEightPercent,

    forms: {
      quarterly: ["1701Q"],
      annual: ["1701"]
    },

    notes: {
      summary: "Kapalit ng percentage tax at graduated rates.",
      warnings: [
        "Dapat piliin sa BIR registration o ideklara sa unang 1701Q ng taon.",
        "Kapag hindi nadeclare sa oras, automatic na babalik sa graduated rates + 3% percentage tax."
      ],
      switching:
        "Kapag nakapili na ng tax option para sa taon, hindi na ito pwedeng palitan hanggang matapos ang taxable year."
    }
  },

  percentageTax: {
    key: "percentageTax",
    label: "Percentage tax (3%)",

    rate: 0.03,
    requiresDeclaration: false,
    excludes: [],

    eligible: a => a.hasBIR && !a.over3M && !a.useEightPercent,

    forms: {
      quarterly: ["2551Q", "1701Q"],
      annual: ["1701"]
    },

    notes: {
      summary: "Hindi pinili ang 8% option."
    }
  },

  vat: {
    key: "vat",
    label: "VAT taxpayer",

    rate: 0.12,
    requiresDeclaration: false,
    excludes: ["2551Q"],

    eligible: a => a.hasBIR && a.over3M,

    forms: {
      quarterly: ["2550Q", "1701Q"],
      annual: ["1701", "AFS"]
    },

    notes: {
      summary: "Lampas ₱3,000,000 ang kita."
    }
  },

  unregistered: {
    key: "unregistered",
    label: "Hindi pa rehistrado",

    rate: null,
    requiresDeclaration: false,
    excludes: [],

    eligible: a => !a.hasBIR,

    forms: {},

    notes: {
      summary: "Kailangan mo munang mag-register sa BIR bago mag-file."
    }
  }
};

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js");
  });
}


function formatPHDate(date) {
  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

// ===== SAFE DOM WRITE (PDF FIX) =====
function safeSetText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}


function generateInvoiceData() {
  const tax = computeTaxType();
  const checklist = computeFilingChecklist();
  const issues = validateCompliance();

  const invoiceId = `INV-${answers.taxYear}-${Date.now()}`;

  const rawDueDates = generateDueDates();

  return {
    invoiceId,
    issuedAt: new Date().toISOString(),
    taxYear: answers.taxYear,

    taxpayerProfile: {
      birRegistered: !!answers.hasBIR,
      onlineSeller: !!answers.online,
      physicalStore: !!answers.hasStore
    },

    tax: {
      type: tax.key,
      label: tax.label,
      rate: tax.rate ?? 0
    },

    income: {
      gross: answers.incomeAmount,
      taxDue: tax.rate ? +(answers.incomeAmount * tax.rate).toFixed(2) : 0
    },

    filing: {
      monthly: checklist.monthly,
      quarterly: checklist.quarterly,
      annual: checklist.annual
    },

    // ✅ FIXED (PH-safe, no timezone bug)
    dueDates: rawDueDates.map(d => ({
      label: d.label,
      date: formatPHDate(d.date)
    })),

    compliance: {
      issues,
      eightPercentDeclared: tax.key === "eightPercent"
    },

    app: {
      name: "Pinoy Tax Assistant",
      version: APP_VERSION
    }
  };
}

// ===== CLASSIFICATION EXPLANATION =====
function getClassificationExplanation() {
  const lines = [];

  if (!answers.hasBIR) {
    lines.push("• Hindi ka pa rehistrado sa BIR.");
    lines.push("• Kailangan muna ang BIR registration bago mag-apply ang tax rules.");
    return lines.join("<br>");
  }

  // Tax type explanation
  if (answers.over3M) {
    lines.push("• Lampas ₱3,000,000 ang declared income mo.");
    lines.push("• Ayon sa batas, automatic kang classified bilang VAT taxpayer.");
  } else if (answers.useEightPercent) {
    lines.push("• BIR registered ka at hindi lampas ₱3,000,000 ang kita.");
    lines.push("• Pinili mo ang 8% income tax option.");
  } else {
    lines.push("• BIR registered ka at hindi lampas ₱3,000,000 ang kita.");
    lines.push("• Hindi mo pinili ang 8% option, kaya percentage tax (3%) ang applicable.");
  }

  // Electronic invoice explanation
  if (requiresElectronicInvoice()) {
    if (answers.over3M) {
      lines.push("• VAT taxpayers ay sakop ng electronic invoicing sa ilalim ng RR 11-2025.");
    }
    if (answers.online) {
      lines.push("• Online sellers ay sakop ng electronic invoicing.");
    }
    if (answers.usesPOS) {
      lines.push("• Gumagamit ka ng POS/CAS na sakop ng electronic invoicing.");
    }
  } else {
    lines.push("• Micro taxpayer ka at hindi ka pa sakop ng mandatory electronic invoicing.");
  }

  lines.push("• Classification lamang ito. Ang transmission ay subject sa BIR rollout.");

  return lines.join("<br>");
}


function exportInvoiceJSON() {
  const invoice = generateInvoiceData();

  const blob = new Blob(
    [JSON.stringify(invoice, null, 2)],
    { type: "application/json" }
  );

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `invoice-${invoice.invoiceId}.json`;
  a.click();

  URL.revokeObjectURL(a.href);
}


// ===== DOM ELEMENTS =====
const questionEl = document.getElementById("question");
const resultEl = document.getElementById("result");
const progressEl = document.getElementById("progress");
const backBtn = document.getElementById("backBtn");

const incomeInput = document.getElementById("incomeInput");
const nextBtn = document.getElementById("nextBtn");
const yesBtn = document.getElementById("yesBtn");
const noBtn = document.getElementById("noBtn");
const resetBtn = document.getElementById("resetBtn");
const calendarBtn = document.getElementById("calendarBtn");
const pdfBtn = document.getElementById("pdfBtn");
const invoiceJsonBtn = document.getElementById("invoiceJsonBtn");
const invoicePdfBtn = document.getElementById("invoicePdfBtn");


const calendarPreview = document.getElementById("calendarPreview");
const calendarList = document.getElementById("calendarList");

const calendarControls = document.getElementById("calendarControls");
const taxYearSelect = document.getElementById("taxYear");
const reminder7 = document.getElementById("reminder7");
const reminder3 = document.getElementById("reminder3");
const reminder0 = document.getElementById("reminder0");

// ===== CALENDAR SETTINGS =====
taxYearSelect.value = answers.taxYear;

taxYearSelect.addEventListener("change", e => {
  answers.taxYear = Number(e.target.value);
  renderCalendarPreview();
});

reminder7.onchange = e => (answers.reminders.before7 = e.target.checked);
reminder3.onchange = e => (answers.reminders.before3 = e.target.checked);
reminder0.onchange = e => (answers.reminders.onDue = e.target.checked);

// ===== TAX COMPUTATION =====
function computeTaxType() {
  return (
    Object.values(TAX_RULES).find(rule => rule.eligible(answers)) ||
    TAX_RULES.unregistered
  );
}

// ===== COMPLIANCE VALIDATOR (FOUNDATION) =====
function validateCompliance() {
  const tax = computeTaxType();
  const issues = [];

  if (tax.requiresDeclaration && !answers.useEightPercent) {
    issues.push("Hindi nadeclare ang 8% option sa tamang oras.");
  }

  // ❌ Removed false-positive excludes warning

  return issues; // ✅ REQUIRED
}

// ===== ELECTRONIC INVOICE REQUIREMENT (RR 11-2025) =====
function requiresElectronicInvoice() {
  if (!answers.hasBIR) return false;

  // VAT taxpayers
  if (answers.over3M) return true;

  // Online sellers / e-commerce
  if (answers.online) return true;

  // POS / CAS users (future-ready)
  if (answers.usesPOS) return true;

  return false; // Micro / exempt
}



// ===== CHECKLIST =====
function computeFilingChecklist() {
  const tax = computeTaxType();

  return {
    monthly:
      tax.key === "eightPercent"
        ? ["Record income"]
        : tax.key === "vat"
        ? ["Record sales & purchases"]
        : tax.key === "percentageTax"
        ? ["Record daily sales"]
        : [],
    quarterly: tax.forms.quarterly || [],
    annual: tax.forms.annual || []
  };
}

// ===== RESULT =====
function showResult() {
  lockUI();

  const tax = computeTaxType();
  const checklist = computeFilingChecklist();
  const formattedIncome = `₱${answers.incomeAmount.toLocaleString()}`;
  const complianceIssues = validateCompliance();
  const eInvoiceRequired = requiresElectronicInvoice();

let eInvoiceLabel = eInvoiceRequired
  ? "✅ Kailangan mag-electronic invoice\nBatay sa sagot mo, sakop ka ng RR 11-2025.\n\nℹ️ Classification only. Transmission requirements are subject to BIR rollout."
  : "❌ Pwede pa sa manual resibo\nMicro taxpayer ka at hindi pa mandatory ang electronic invoice.\n\nℹ️ Classification only. Transmission requirements are subject to BIR rollout.";


  let notes = `Tax type: ${tax.label}\n${tax.notes.summary}\n\n`;

  if (tax.notes.warnings) {
    notes += "⚠️ Paalala:\n";
    tax.notes.warnings.forEach(w => (notes += `• ${w}\n`));
    notes += "\n🔁 Switching Rules:\n" + tax.notes.switching + "\n\n";
  }

  if (complianceIssues.length) {
    notes += "🚨 Compliance Check:\n";
    complianceIssues.forEach(i => (notes += `• ${i}\n`));
    notes += "\n";
  }

  questionEl.innerText = "Resulta";
 resultEl.innerText =
  `Kita mo: ${formattedIncome}\n\n` +
 `🧾 **Electronic Invoice Requirement**\n${eInvoiceLabel}\n\n` +
  notes +
  `📅 Filing Checklist\n\n` +
  `Monthly:\n- ${checklist.monthly.join("\n- ")}\n\n` +
  `Quarterly:\n- ${checklist.quarterly.join("\n- ")}\n\n` +
  `Annual:\n- ${checklist.annual.join("\n- ")}`;


  renderCalendarPreview();
  calendarControls.style.display = "block";
  calendarBtn.style.display = "block";
  pdfBtn.style.display = "block";
  resetBtn.style.display = "block";
  invoiceJsonBtn.style.display = "block";
invoicePdfBtn.style.display = "block";


  localStorage.setItem(
  "taxAppResult",
  JSON.stringify({
    answers,
    tax: tax.key,
    checklist,
    dueDates: generateDueDates(),
    generatedAt: new Date().toISOString(),
    appVersion: APP_VERSION
  })
);

// ===== WHY AM I CLASSIFIED (RESULT-ONLY) =====
const whyToggle = document.getElementById("whyToggle");
const whyContent = document.getElementById("whyContent");

whyContent.innerHTML = getClassificationExplanation();
whyToggle.style.display = "block";
whyContent.style.display = "none"; // always collapsed by default

}



// ===== UI LOCK (MISSING FUNCTION FIX) =====
function lockUI() {
  progressEl.style.display = "none";
  backBtn.style.display = "none";

  yesBtn.style.display = "none";
  noBtn.style.display = "none";

  incomeInput.style.display = "none";
  nextBtn.style.display = "none";
}

// ===== ANSWER HANDLER =====
function answer(value) {
  const boolValue = Boolean(value);

  if (step === 1) {
    answers.hasBIR = boolValue;
    step = 2;
  } 
  else if (step === 2) {
    answers.online = boolValue;
    step = 3;
  } 
  else if (step === 3) {
    answers.hasStore = boolValue;
    step = 4;
    showIncomeStep();
    return;
  } 
  else if (step === 5) {
    answers.useEightPercent = boolValue;
    showResult();
    return;
  }

  showNextQuestion();
}



function showNextQuestion() {
  progressEl.innerText = `Step ${step} of 5`;

  const questions = {
    1: "May BIR registration ka na ba?",
    2: "Online ka ba kumikita o nagbebenta?",
    3: "May physical store ka ba?"
  };

  questionEl.innerText = questions[step] || "";
  yesBtn.style.display = "block";
  noBtn.style.display = "block";
  updateBackButton();
}
function showIncomeStep() {
  questionEl.innerText = "Magkano ang tinatayang kita mo sa isang taon? (₱)";
  progressEl.innerText = "Step 4 of 5";

  incomeInput.style.display = "block";
  nextBtn.style.display = "block";
  yesBtn.style.display = "none";
  noBtn.style.display = "none";

  updateBackButton();
}

function saveIncome() {
  const value = Number(incomeInput.value);
  if (!value || value <= 0) {
    alert("Pakilagay ang tamang halaga.");
    return;
  }

  answers.incomeAmount = value;
  answers.over3M = value > 3000000;

  incomeInput.style.display = "none";
  nextBtn.style.display = "none";

  if (answers.hasBIR && !answers.over3M && (answers.online || answers.hasStore)) {
    step = 5;
    showEightPercentQuestion();
  } else {
    showResult();
  }
}

function updateBackButton() {
  backBtn.style.display = step > 1 ? "block" : "none";
}
function goBack() {
  if (step <= 1) return;

  // Clear result-only UI
  resultEl.innerText = "";
  calendarList.innerHTML = "";
  calendarPreview.style.display = "none";
  calendarControls.style.display = "none";
  calendarBtn.style.display = "none";
  pdfBtn.style.display = "none"; 
  resetBtn.style.display = "none";

  // Restore base UI
  progressEl.style.display = "block";
  yesBtn.style.display = "block";
  noBtn.style.display = "block";
  incomeInput.style.display = "none";
  nextBtn.style.display = "none";

  // Step rollback logic
  if (step === 5) {
    // From 8% question → income input
    step = 4;
    showIncomeStep();
    return;
  }

  if (step === 4) {
    // From income → physical store
    step = 3;
  } else {
    step--;
  }

  const questions = {
    1: "May BIR registration ka na ba?",
    2: "Online ka ba kumikita o nagbebenta?",
    3: "May physical store ka ba?"
  };

  questionEl.innerText = questions[step];
  progressEl.innerText = `Step ${step} of 5`;

  updateBackButton();
}

// ===== DUE DATE GENERATOR (RESTORED) =====
function generateDueDates() {
  const dates = [];
  const year = answers.taxYear;

  if (!answers.hasBIR) return dates;

  const tax = computeTaxType();

  // VAT
  if (tax.key === "vat") {
    TAX_DUE_DATES.vat.months.forEach(m => {
      dates.push({
        label: `VAT (${TAX_DUE_DATES.vat.form})`,
        date: new Date(year, m - 1, TAX_DUE_DATES.vat.day)
      });
    });
  }

  // Percentage tax (non-8%)
  if (tax.key === "percentageTax") {
    TAX_DUE_DATES.percentage.months.forEach(m => {
      dates.push({
        label: `Percentage Tax (${TAX_DUE_DATES.percentage.form})`,
        date: new Date(year, m - 1, TAX_DUE_DATES.percentage.day)
      });
    });
  }


// Quarterly income tax
TAX_DUE_DATES.quarterlyIncome.months.forEach((m, index) => {
  const isQ1 = m === 5; // May = Q1 filing

  dates.push({
    label: `Income Tax (${TAX_DUE_DATES.quarterlyIncome.form})`,
    date: new Date(year, m - 1, TAX_DUE_DATES.quarterlyIncome.day),
    note:
      tax.key === "eightPercent" && isQ1
        ? "⚠️ Declaration point for 8% option. Missing this causes fallback to graduated rates + percentage tax."
        : null
  });
});

  // Annual income tax
  dates.push({
    label: `Annual Income Tax (${TAX_DUE_DATES.annualIncome.form})`,
    date: new Date(year, 3, TAX_DUE_DATES.annualIncome.day)
  });

  return dates;
}


// ===== PDF EXPORT (PHASE 3) =====
// ===== PDF EXPORT (PHASE 3 — SAFE) =====
function exportPDF() {
  const page = document.querySelector("#pdfExport .pdf-page");
  if (!page) {
    alert("PDF layout not found. Please reload the page.");
    return;
  }

  const tax = computeTaxType();
  const checklist = computeFilingChecklist();
  const dates = generateDueDates();
  const issues = validateCompliance();
  const eInvoiceRequired = requiresElectronicInvoice();

  const eInvoiceText = eInvoiceRequired
    ? "Kailangan mag-electronic invoice (RR 11-2025)\nClassification only. Transmission requirements are subject to BIR rollout."
    : "Manual resibo pa ang pinapayagan (Micro taxpayer)\nClassification only. Transmission requirements are subject to BIR rollout.";

  // 📝 SAFE POPULATION
  safeSetText(
    "pdfMeta",
    `Generated: ${new Date().toLocaleString("en-PH")}\n` +
    `Tax Year: ${answers.taxYear}\n` +
    `App Version: ${APP_VERSION}`
  );

  safeSetText(
    "pdfProfile",
    `BIR Registered: ${answers.hasBIR ? "Yes" : "No"}\n` +
    `Online Seller: ${answers.online ? "Yes" : "No"}\n` +
    `Physical Store: ${answers.hasStore ? "Yes" : "No"}\n` +
    `Declared Income: ₱${answers.incomeAmount.toLocaleString("en-PH")}`
  );

  safeSetText(
    "pdfResult",
    `${tax.label}\n${tax.notes.summary}\n\nElectronic Invoice Requirement:\n${eInvoiceText}`
  );

  safeSetText(
    "pdfChecklist",
    `Monthly:\n- ${checklist.monthly.join("\n- ") || "None"}\n\n` +
    `Quarterly:\n- ${checklist.quarterly.join("\n- ") || "None"}\n\n` +
    `Annual:\n- ${checklist.annual.join("\n- ") || "None"}`
  );

  safeSetText(
    "pdfDates",
    dates.map(d =>
      `${d.label} – ${d.date.toLocaleDateString("en-PH", {
        month: "long",
        day: "numeric"
      })}${d.note ? `\n${d.note}` : ""}`
    ).join("\n\n")
  );

  safeSetText(
    "pdfWarnings",
    issues.length
      ? issues.map(i => `⚠️ ${i}`).join("\n")
      : "No compliance issues detected."
  );

  document.body.classList.add("pdf-export");

  const clone = page.cloneNode(true);
  document.body.appendChild(clone);




html2pdf()
  .set({
    filename: `pinoy-tax-compliance-${answers.taxYear}.pdf`,
    margin: 12,
    pagebreak: { mode: ["css", "legacy"] },
    html2canvas: {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true
    },
    jsPDF: {
      unit: "mm",
      format: "a4",
      orientation: "portrait"
    }
  })
  .from(clone)
  .save()
  .then(() => {
    clone.remove();
    document.body.classList.remove("pdf-export");
  });



function exportInvoicePDF() {
  const invoice = generateInvoiceData();
  const page = document.querySelector("#invoicePdfExport .pdf-page");

  if (!page) {
    alert("Invoice PDF layout not found. Please reload the page.");
    return;
  }

  const eInvoiceRequired = requiresElectronicInvoice();

  const invoiceTypeLabel = eInvoiceRequired
    ? "Electronic Invoice (RR 11-2025)\nClassification only. Transmission requirements are subject to BIR rollout."
    : "Manual Invoice – Micro Taxpayer (Exempt)\nClassification only. Transmission requirements are subject to BIR rollout.";

  const grossIncome = invoice.income?.gross || 0;
  const taxRate = invoice.tax?.rate || 0;
  const taxDue = invoice.income?.taxDue || 0;

  safeSetText(
    "invoicePdfMeta",
    `Invoice ID: ${invoice.invoiceId}\n` +
    `Issued: ${new Date(invoice.issuedAt).toLocaleString("en-PH")}\n` +
    `Tax Year: ${invoice.taxYear}\n` +
    `App Version: ${invoice.app.version}`
  );

  safeSetText(
    "invoicePdfProfile",
    `BIR Registered: ${invoice.taxpayerProfile.birRegistered ? "Yes" : "No"}\n` +
    `Online Seller: ${invoice.taxpayerProfile.onlineSeller ? "Yes" : "No"}\n` +
    `Physical Store: ${invoice.taxpayerProfile.physicalStore ? "Yes" : "No"}\n` +
    `Declared Income: ₱${grossIncome.toLocaleString("en-PH")}`
  );

  safeSetText(
    "invoicePdfResult",
    `${invoice.tax.label}\nInvoice Type: ${invoiceTypeLabel}\n` +
    `Rate: ${(taxRate * 100).toFixed(0)}%\n` +
    `Estimated annual tax (reference): ₱${taxDue.toLocaleString("en-PH")}`
  );

  safeSetText(
    "invoicePdfAmounts",
    `Gross Income: ₱${grossIncome.toLocaleString("en-PH")}\n` +
    `Tax Rate: ${(taxRate * 100).toFixed(0)}%\n` +
    `Estimated tax based on declared income (annual reference): ₱${taxDue.toLocaleString("en-PH")}`
  );

  safeSetText(
    "invoicePdfChecklist",
    `Monthly:\n- ${invoice.filing.monthly.length ? invoice.filing.monthly.join("\n- ") : "None"}\n\n` +
    `Quarterly:\n- ${invoice.filing.quarterly.length ? invoice.filing.quarterly.join("\n- ") : "None"}\n\n` +
    `Annual:\n- ${invoice.filing.annual.length ? invoice.filing.annual.join("\n- ") : "None"}`
  );

  safeSetText(
    "invoicePdfDates",
    invoice.dueDates.map(d => `${d.label} – ${d.date}`).join("\n")
  );

  safeSetText(
    "invoicePdfWarnings",
    invoice.compliance.issues.length
      ? invoice.compliance.issues.map(i => `⚠️ ${i}`).join("\n")
      : "No compliance issues detected."
  );

  document.body.classList.add("pdf-export");

  const clone = page.cloneNode(true);
  document.body.appendChild(clone);


  html2pdf()
  .set({
    filename: `invoice-${invoice.invoiceId}.pdf`,
    margin: 12,
    pagebreak: { mode: ["css", "legacy"] },
    html2canvas: {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true
    },
    jsPDF: {
      unit: "mm",
      format: "a4",
      orientation: "portrait"
    }
  })
  .from(clone)
  .save()
  .then(() => {
    clone.remove();
    document.body.classList.remove("pdf-export");
  });




function renderCalendarPreview() {
  calendarList.innerHTML = "";

  generateDueDates().forEach(d => {
    const li = document.createElement("li");

    li.innerText =
      `${d.label} – ${d.date.toLocaleDateString("en-PH", {
        month: "long",
        day: "numeric"
      })}` +
      (d.note ? `\n${d.note}` : "");

    calendarList.appendChild(li);
  });

  calendarPreview.style.display = "block";
}


function exportCalendar() {
  if (!answers.hasBIR) {
    alert("Kailangan munang mag-register sa BIR bago makapag-export.");
    return;
  }

  const events = generateDueDates();
  if (!events.length) {
    alert("Walang due dates na pwedeng i-export.");
    return;
  }

  let ics = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Pinoy Tax Assistant//EN\n";

  events.forEach(e => {
    const d = e.date.toISOString().split("T")[0].replace(/-/g, "");
    ics += `BEGIN:VEVENT
SUMMARY:${e.label}
DTSTART;VALUE=DATE:${d}
DTEND;VALUE=DATE:${d}
END:VEVENT
`;
  });

  ics += "END:VCALENDAR";

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `pinoy-tax-calendar-${answers.taxYear}.ics`;
  a.click();

  URL.revokeObjectURL(url);
}




function resetApp() {
  localStorage.removeItem("taxAppResult");
  step = 1;

  answers = {
    reminders: { before7: true, before3: true, onDue: true },
    taxYear: new Date().getFullYear()
  };

  // Clear result & calendar
  resultEl.innerText = "";
  calendarPreview.style.display = "none";
  calendarControls.style.display = "none";
  calendarBtn.style.display = "none";
  pdfBtn.style.display = "none";
  resetBtn.style.display = "none";

  invoiceJsonBtn.style.display = "none";
  invoicePdfBtn.style.display = "none";

  // Restore Step 1 UI
  progressEl.style.display = "block";
  progressEl.innerText = "Step 1 of 5";
  questionEl.innerText = "May BIR registration ka na ba?";

  yesBtn.style.display = "block";
  noBtn.style.display = "block";

  incomeInput.style.display = "none";
  nextBtn.style.display = "none";
  backBtn.style.display = "none";

  const whyToggle = document.getElementById("whyToggle");
const whyContent = document.getElementById("whyContent");

if (whyToggle) whyToggle.style.display = "none";
if (whyContent) whyContent.style.display = "none";

}


// ===== 8% QUESTION (MISSING FUNCTION FIX) =====
function showEightPercentQuestion() {
  questionEl.innerText = "Pinili mo ba ang 8% income tax option?";
  progressEl.innerText = "Step 5 of 5";

  incomeInput.style.display = "none";
  nextBtn.style.display = "none";

  yesBtn.style.display = "inline-block";
  noBtn.style.display = "inline-block";

  updateBackButton();
}


yesBtn.addEventListener("click", () => answer(true));
noBtn.addEventListener("click", () => answer(false));
nextBtn.addEventListener("click", saveIncome);
backBtn.addEventListener("click", goBack);
calendarBtn.addEventListener("click", exportCalendar);
resetBtn.addEventListener("click", resetApp);
if (pdfBtn) {
  pdfBtn.addEventListener("click", exportPDF);
}
invoiceJsonBtn.addEventListener("click", exportInvoiceJSON);
invoicePdfBtn.addEventListener("click", exportInvoicePDF);

// ===== WHY AM I CLASSIFIED TOGGLE =====


// ===== WHY AM I CLASSIFIED TOGGLE =====
const whyBtn = document.getElementById("whyBtn");


if (whyBtn && whyContent) {
  whyBtn.addEventListener("click", () => {
    const isVisible = whyContent.style.display === "block";
    whyContent.style.display = isVisible ? "none" : "block";
  });
}


