// Zuruf — App-Logik
// SUPABASE_URL und SUPABASE_ANON_KEY sind öffentliche Werte (siehe backend.md).
// Sie schützen keine Daten — das tun die Zugriffsregeln (RLS) im Backend.
const SUPABASE_URL = "https://iapgoscuvedtczvtorii.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_QzmVHUG_Ihfxwz3ofmWlzA_uw_GuTci";

// "Angemeldet bleiben": bestimmt, ob die Sitzung über das Schließen des
// Browsers hinaus gespeichert wird (localStorage) oder nur für diese
// Browser-Sitzung gilt (sessionStorage).
let bleibtAngemeldet = localStorage.getItem("zuruf-bleiben") !== "false";

const wechselndeAblage = {
  getItem: (schluessel) => (bleibtAngemeldet ? localStorage : sessionStorage).getItem(schluessel),
  setItem: (schluessel, wert) => (bleibtAngemeldet ? localStorage : sessionStorage).setItem(schluessel, wert),
  removeItem: (schluessel) => (bleibtAngemeldet ? localStorage : sessionStorage).removeItem(schluessel),
};

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: wechselndeAblage,
  },
});

// --- Bildschirme wechseln ---
function zeigeBildschirm(id) {
  document.querySelectorAll(".bildschirm").forEach((el) => el.classList.remove("aktiv"));
  document.getElementById(id).classList.add("aktiv");
}

// --- Anmeldung ---
const emailFeld = document.getElementById("anmelde-email");
const bleibenCheckbox = document.getElementById("anmelde-bleiben");
const sendenKnopf = document.getElementById("anmelde-senden");
const statusText = document.getElementById("anmelde-status");

bleibenCheckbox.checked = bleibtAngemeldet;

bleibenCheckbox.addEventListener("change", () => {
  bleibtAngemeldet = bleibenCheckbox.checked;
  localStorage.setItem("zuruf-bleiben", String(bleibtAngemeldet));
});

sendenKnopf.addEventListener("click", async () => {
  const email = emailFeld.value.trim();
  if (!email) {
    statusText.textContent = "Bitte gib deine E-Mail-Adresse ein.";
    return;
  }

  sendenKnopf.disabled = true;
  statusText.textContent = "Sende Anmelde-Link …";

  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
  });

  sendenKnopf.disabled = false;

  if (error) {
    if (error.status === 429 || /rate limit/i.test(error.message)) {
      statusText.textContent = "Zu viele Versuche — der eingebaute Mailversand erlaubt nur wenige E-Mails pro Stunde. Bitte etwas warten.";
    } else {
      statusText.textContent = "Das hat nicht geklappt: " + error.message;
    }
    return;
  }

  statusText.textContent = "E-Mail unterwegs — öffne sie und tippe auf den Link.";
});

// --- Abmelden ---
document.getElementById("knopf-abmelden").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
});

// --- Einstellungen für das Modell (nur auf diesem Gerät gespeichert) ---
const adresseFeld = document.getElementById("einstellungen-adresse");
const modellFeld = document.getElementById("einstellungen-modell");
const schluesselFeld = document.getElementById("einstellungen-schluessel");

adresseFeld.value = localStorage.getItem("zuruf-modell-adresse") || "https://api.anthropic.com";
modellFeld.value = localStorage.getItem("zuruf-modell-name") || "claude-haiku-4-5-20251001";
schluesselFeld.value = localStorage.getItem("zuruf-modell-schluessel") || "";

document.getElementById("knopf-einstellungen-modell-speichern").addEventListener("click", () => {
  localStorage.setItem("zuruf-modell-adresse", adresseFeld.value.trim());
  localStorage.setItem("zuruf-modell-name", modellFeld.value.trim());
  localStorage.setItem("zuruf-modell-schluessel", schluesselFeld.value.trim());
  zeigeBildschirm("bildschirm-haupt");
});

// --- Das Modell aufrufen: aus dem Rohtext einen Vorschlag machen lassen ---
const ERLAUBTE_ARTEN = ["aufgabe", "notiz", "kundennotiz", "beleg", "einkauf"];

async function rufeModellAuf(text) {
  const adresse = localStorage.getItem("zuruf-modell-adresse");
  const modell = localStorage.getItem("zuruf-modell-name");
  const schluessel = localStorage.getItem("zuruf-modell-schluessel");

  if (!adresse || !modell || !schluessel) return null;

  const heute = new Date().toISOString().slice(0, 10);
  const systemAnweisung =
    'Du liest eine kurze, unterwegs gesprochene oder getippte deutsche Notiz. ' +
    'Antworte NUR mit einem JSON-Objekt, keine Erklärung, kein Markdown. Felder: ' +
    '"titel" (kurzer Titel, max. 8 Wörter), ' +
    '"art" (genau eines von: aufgabe, notiz, kundennotiz, beleg, einkauf), ' +
    '"faellig_am" (Datum als JJJJ-MM-TT, wenn im Text ein Datum/Zeitbezug erkennbar ist, sonst null). ' +
    "Heutiges Datum: " + heute + ".";

  const abbruch = new AbortController();
  const zeitlimit = setTimeout(() => abbruch.abort(), 15000);

  try {
    const antwort = await fetch(adresse.replace(/\/$/, "") + "/v1/messages", {
      method: "POST",
      signal: abbruch.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": schluessel,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: modell,
        max_tokens: 300,
        system: systemAnweisung,
        messages: [{ role: "user", content: text }],
      }),
    });

    if (!antwort.ok) return null;

    const daten = await antwort.json();
    const rohtext = daten.content && daten.content[0] && daten.content[0].text;
    if (!rohtext) return null;

    const treffer = rohtext.match(/\{[\s\S]*\}/);
    if (!treffer) return null;

    const vorschlag = JSON.parse(treffer[0]);
    if (!ERLAUBTE_ARTEN.includes(vorschlag.art)) vorschlag.art = null;
    return vorschlag;
  } catch (fehler) {
    return null;
  } finally {
    clearTimeout(zeitlimit);
  }
}

// --- Sprechen, Tippen, Vorschlags-Karte ---
let erfassterText = "";
let erfassteQuelle = "tippen";
let aktuelleArt = null;

const ART_ANZEIGENAMEN = {
  aufgabe: "Aufgabe",
  notiz: "Notiz",
  kundennotiz: "Kundennotiz",
  beleg: "Beleg",
  einkauf: "Einkauf",
};

function zeigeArt(art) {
  aktuelleArt = art;
  document.getElementById("vorschlag-art").textContent = art ? ART_ANZEIGENAMEN[art] : "–";
}

document.getElementById("vorschlag-art").addEventListener("click", () => {
  const naechsterIndex = (ERLAUBTE_ARTEN.indexOf(aktuelleArt) + 1) % ERLAUBTE_ARTEN.length;
  zeigeArt(ERLAUBTE_ARTEN[naechsterIndex]);
});

document.getElementById("knopf-vorschlag-aendern").addEventListener("click", () => {
  const titelFeld = document.getElementById("vorschlag-titel");
  titelFeld.readOnly = false;
  titelFeld.focus();
  titelFeld.select();
});

async function zeigeVorschlagsKarte(text, quelle) {
  erfassterText = text;
  erfassteQuelle = quelle;
  document.getElementById("vorschlag-erkannter-text").textContent = "„" + text + "“";
  document.getElementById("vorschlag-titel").value = "Denkt nach …";
  document.getElementById("vorschlag-titel").readOnly = true;
  zeigeArt(null);
  document.getElementById("vorschlag-faelligkeit").textContent = "–";
  zeigeBildschirm("bildschirm-vorschlag");

  const vorschlag = await rufeModellAuf(text);

  if (!vorschlag) {
    document.getElementById("vorschlag-titel").value = text.slice(0, 60);
    return;
  }

  document.getElementById("vorschlag-titel").value = vorschlag.titel || text.slice(0, 60);
  zeigeArt(vorschlag.art || null);
  document.getElementById("vorschlag-faelligkeit").textContent = vorschlag.faellig_am || "–";
}

function oeffneTippen() {
  document.getElementById("tippen-text").value = "";
  zeigeBildschirm("bildschirm-tippen");
  document.getElementById("tippen-text").focus();
}

document.getElementById("knopf-tippen").addEventListener("click", oeffneTippen);
document.getElementById("knopf-tippen-abbrechen").addEventListener("click", () => zeigeBildschirm("bildschirm-haupt"));
document.getElementById("knopf-vorschlag-schliessen").addEventListener("click", () => zeigeBildschirm("bildschirm-haupt"));

let einkaufModus = false;

document.getElementById("knopf-einkauf").addEventListener("click", () => {
  einkaufModus = true;
  oeffneTippen();
});

document.getElementById("knopf-tippen-weiter").addEventListener("click", () => {
  const text = document.getElementById("tippen-text").value.trim();
  if (!text) return;

  if (einkaufModus) {
    einkaufModus = false;
    erfassterText = text;
    erfassteQuelle = "tippen";
    ausstehendesFoto = null;
    document.getElementById("vorschlag-erkannter-text").textContent = "„" + text + "“";
    document.getElementById("vorschlag-titel").value = text.slice(0, 60);
    document.getElementById("vorschlag-titel").readOnly = true;
    zeigeArt("einkauf");
    document.getElementById("vorschlag-faelligkeit").textContent = "–";
    zeigeBildschirm("bildschirm-vorschlag");
    return;
  }

  zeigeVorschlagsKarte(text, "tippen");
});

// --- FOTO: Bild aufnehmen, als Beleg vorschlagen ---
let ausstehendesFoto = null;
const fotoEingabe = document.getElementById("foto-eingabe");

document.getElementById("knopf-foto").addEventListener("click", () => {
  fotoEingabe.value = "";
  fotoEingabe.click();
});

fotoEingabe.addEventListener("change", () => {
  const datei = fotoEingabe.files[0];
  if (!datei) return;

  ausstehendesFoto = datei;
  erfassterText = "Foto: " + datei.name;
  erfassteQuelle = "foto";
  const heuteLesbar = new Date().toLocaleDateString("de-DE");
  document.getElementById("vorschlag-erkannter-text").textContent = "Foto aufgenommen";
  document.getElementById("vorschlag-titel").value = "Beleg vom " + heuteLesbar;
  document.getElementById("vorschlag-titel").readOnly = true;
  zeigeArt("beleg");
  document.getElementById("vorschlag-faelligkeit").textContent = "–";
  zeigeBildschirm("bildschirm-vorschlag");
});

const SpracherkennungsKlasse = window.SpeechRecognition || window.webkitSpeechRecognition;
const sprechenKnopf = document.getElementById("knopf-sprechen");

sprechenKnopf.addEventListener("click", () => {
  if (!SpracherkennungsKlasse) {
    // Browser kann keine Spracheingabe -> ohne Fehlermeldung auf Tippen umschalten
    oeffneTippen();
    return;
  }

  const erkennung = new SpracherkennungsKlasse();
  erkennung.lang = "de-DE";
  erkennung.interimResults = false;
  erkennung.maxAlternatives = 1;

  sprechenKnopf.classList.add("hoert-zu");
  sprechenKnopf.querySelector(".symbol").textContent = "🔴";

  const zuruecksetzen = () => {
    sprechenKnopf.classList.remove("hoert-zu");
    sprechenKnopf.querySelector(".symbol").textContent = "🎙️";
  };

  erkennung.onresult = (ereignis) => {
    const text = ereignis.results[0][0].transcript;
    zuruecksetzen();
    zeigeVorschlagsKarte(text, "sprache");
  };

  erkennung.onerror = () => {
    // Kein Mikrofon-Zugriff oder anderer Fehler -> ohne Fehlermeldung auf Tippen umschalten
    zuruecksetzen();
    oeffneTippen();
  };

  erkennung.onend = zuruecksetzen;

  erkennung.start();
});

// --- Übernehmen: in der Datenbank speichern ---
let aktuellerNutzer = null;
const uebernehmenKnopf = document.getElementById("knopf-vorschlag-uebernehmen");

uebernehmenKnopf.addEventListener("click", async () => {
  if (!aktuellerNutzer) return;

  uebernehmenKnopf.disabled = true;
  const titel = document.getElementById("vorschlag-titel").value.trim();
  const faelligkeitRoh = document.getElementById("vorschlag-faelligkeit").textContent.trim();
  const faelligAm = /^\d{4}-\d{2}-\d{2}$/.test(faelligkeitRoh) ? faelligkeitRoh : null;

  let fotoPfad = null;
  if (ausstehendesFoto) {
    const pfad = aktuellerNutzer.id + "/" + Date.now() + "-" + ausstehendesFoto.name;
    const { error: hochladeFehler } = await supabaseClient.storage.from("belege").upload(pfad, ausstehendesFoto);
    if (hochladeFehler) {
      alert("Das Foto konnte nicht gespeichert werden: " + hochladeFehler.message);
      uebernehmenKnopf.disabled = false;
      return;
    }
    fotoPfad = pfad;
  }

  const { error } = await supabaseClient.from("zurufe").insert({
    user_id: aktuellerNutzer.id,
    text: erfassterText,
    titel: titel || erfassterText.slice(0, 60),
    art: aktuelleArt,
    faellig_am: faelligAm,
    quelle: erfassteQuelle,
    foto_pfad: fotoPfad,
  });

  uebernehmenKnopf.disabled = false;
  ausstehendesFoto = null;

  if (error) {
    alert("Das hat nicht geklappt: " + error.message);
    return;
  }

  zeigeBildschirm("bildschirm-haupt");
  ladeEintraege();
});

// --- Liste laden und anzeigen ---
const ART_SYMBOLE = {
  aufgabe: "✅",
  notiz: "📝",
  kundennotiz: "💬",
  beleg: "🧾",
  einkauf: "🛒",
};

let aktiverFilter = "alle";

function formatiereFaelligkeit(faelligAm) {
  if (!faelligAm) return null;
  const heute = new Date().toISOString().slice(0, 10);
  if (faelligAm < heute) return "Überfällig: " + faelligAm;
  if (faelligAm === heute) return "Fällig: heute";
  return "Fällig: " + faelligAm;
}

function sortierWertOffen(eintrag) {
  const heute = new Date().toISOString().slice(0, 10);
  if (!eintrag.faellig_am) return [2, eintrag.erstellt_am].join("|");
  if (eintrag.faellig_am < heute) return [0, eintrag.faellig_am].join("|");
  if (eintrag.faellig_am === heute) return [1, eintrag.faellig_am].join("|");
  return [3, eintrag.faellig_am].join("|");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function baueEintragElement(eintrag) {
  const div = document.createElement("div");
  div.className = "eintrag";

  const faelligkeitText = formatiereFaelligkeit(eintrag.faellig_am);
  const ergebnisZeile = eintrag.ergebnis
    ? '<div class="meta" style="margin-top:6px; font-style:italic;">↳ ' + escapeHtml(eintrag.ergebnis) + "</div>"
    : "";

  div.innerHTML =
    '<div class="art-symbol">' + (ART_SYMBOLE[eintrag.art] || "❓") + '</div>' +
    '<div class="inhalt">' +
      '<p class="eintrag-titel">' + escapeHtml(eintrag.titel || eintrag.text) + '</p>' +
      '<div class="meta">' +
        '<span class="status-punkt ' + eintrag.status + '">' + eintrag.status + '</span>' +
        (faelligkeitText ? "<span>" + escapeHtml(faelligkeitText) + "</span>" : "") +
      '</div>' +
      ergebnisZeile +
    '</div>';

  div.addEventListener("click", async () => {
    const neuerStatus = eintrag.status === "offen" ? "erledigt" : "offen";
    const { error } = await supabaseClient.from("zurufe").update({ status: neuerStatus }).eq("id", eintrag.id);
    if (!error) ladeEintraege();
  });

  return div;
}

function renderListe(eintraege) {
  const gefiltert = aktiverFilter === "alle" ? eintraege : eintraege.filter((e) => e.art === aktiverFilter);

  const offen = gefiltert.filter((e) => e.status === "offen").sort((a, b) => (sortierWertOffen(a) > sortierWertOffen(b) ? 1 : -1));
  const erledigt = gefiltert.filter((e) => e.status !== "offen").sort((a, b) => (a.erstellt_am < b.erstellt_am ? 1 : -1));

  const offenContainer = document.getElementById("eintraege-offen");
  offenContainer.innerHTML = "";
  offen.forEach((e) => offenContainer.appendChild(baueEintragElement(e)));

  document.getElementById("eintraege-leer").style.display = gefiltert.length === 0 ? "block" : "none";

  const erledigtBlock = document.getElementById("eintraege-erledigt-block");
  const erledigtContainer = document.getElementById("eintraege-erledigt");
  erledigtContainer.innerHTML = "";
  if (erledigt.length > 0) {
    erledigtBlock.style.display = "block";
    document.getElementById("eintraege-erledigt-zusammenfassung").textContent = erledigt.length + " erledigt/abgelegt anzeigen";
    erledigt.forEach((e) => erledigtContainer.appendChild(baueEintragElement(e)));
  } else {
    erledigtBlock.style.display = "none";
  }
}

async function ladeEintraege() {
  const { data, error } = await supabaseClient.from("zurufe").select("*").order("erstellt_am", { ascending: false });
  if (error) return;
  renderListe(data);
}

document.getElementById("filterleiste").addEventListener("click", (ereignis) => {
  const chip = ereignis.target.closest(".filter-chip");
  if (!chip) return;
  document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("aktiv"));
  chip.classList.add("aktiv");
  aktiverFilter = chip.dataset.art;
  ladeEintraege();
});

// --- Einstellungen öffnen/schließen ---
document.getElementById("knopf-einstellungen-oeffnen").addEventListener("click", () => {
  zeigeBildschirm("bildschirm-einstellungen");
});
document.getElementById("knopf-einstellungen-schliessen").addEventListener("click", () => {
  zeigeBildschirm("bildschirm-haupt");
});

// --- Anmeldestatus verfolgen ---
supabaseClient.auth.onAuthStateChange((ereignis, sitzung) => {
  if (sitzung) {
    aktuellerNutzer = sitzung.user;
    document.getElementById("einstellungen-email").textContent = sitzung.user.email;
    zeigeBildschirm("bildschirm-haupt");
    ladeEintraege();
  } else {
    aktuellerNutzer = null;
    zeigeBildschirm("bildschirm-anmeldung");
  }
});

// Beim Laden prüfen, ob schon eine Sitzung besteht (z. B. nach Klick auf den Anmelde-Link)
supabaseClient.auth.getSession().then(({ data }) => {
  if (data.session) {
    aktuellerNutzer = data.session.user;
    document.getElementById("einstellungen-email").textContent = data.session.user.email;
    zeigeBildschirm("bildschirm-haupt");
    ladeEintraege();
  }
});
