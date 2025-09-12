import { useState, useEffect } from "react";
import axios from "axios";
import Papa from "papaparse";
import "./App.css";

/** -------------------- CONFIG -------------------- */
const LIST_FIELDS = {
  credit: ["Eligible Credit Cards", "Eligible Cards"],
  debit: ["Eligible Debit Cards", "Applicable Debit Cards"],
  title: ["Offer Title", "Title"],
  image: ["Image", "Credit Card Image"],
  link: ["Link"],
  desc: ["Description", "Details", "Offer Description", "Flight Benefit"],
  permanentCCName: ["Credit Card Name"],
  permanentBenefit: ["Flight Benefit", "Benefit", "Offer"],
};

const MAX_SUGGESTIONS = 50;

/** show per-card variant note inside every OTA card */
const SHOW_VARIANT_NOTE_SITES = new Set([
  "EaseMyTrip",
  "Yatra (Domestic)",
  "Yatra (International)",
  "Ixigo",
  "MakeMyTrip",
  "ClearTrip",
  "Goibibo",
  "Airline",
  "Permanent",
]);

/** Network & tier alias maps */
const NETWORK_ALIASES = {
  visa: ["visa", "vs"],
  mastercard: ["mastercard", "master card", "mc", "master"],
  rupay: ["rupay", "ru-pay", "ru pay"],
  amex: ["amex", "americanexpress", "american express"],
  diners: ["diners", "dinersclub", "diners club"],
};

const TIER_ALIASES = {
  signature: ["signature", "sig"],
  platinum: ["platinum", "plat"],
  world: ["world"],
  select: ["select"],
  classic: ["classic"],
  titanium: ["titanium"],
  elite: ["elite"],
  prime: ["prime"],
  gold: ["gold"],
  infinite: ["infinite", "infinity"],
  black: ["black"],
};

/** -------------------- HELPERS -------------------- */
function firstField(obj, keys) {
  for (const k of keys) {
    if (
      obj &&
      Object.prototype.hasOwnProperty.call(obj, k) &&
      obj[k] !== undefined &&
      obj[k] !== null &&
      String(obj[k]).trim() !== ""
    ) {
      return obj[k];
    }
  }
  return undefined;
}

function splitList(val) {
  if (!val) return [];
  return String(val)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function capFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Extract base + optional variant from cards where the variant is provided in parentheses after the name */
function extractVariant(name) {
  const raw = String(name || "");

  // base = text before the last trailing (...) group, if any
  const base = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();

  // variant = inside trailing parentheses, if present
  const match = raw.match(/\(([^)]+)\)\s*$/);
  const variantFromParens = match ? match[1].trim() : null;

  if (variantFromParens) {
    return { base, variant: variantFromParens };
  }

  // fallback (rare): infer from aliases in case a CSV missed parentheses
  const lower = raw.toLowerCase();
  const networks = Object.keys(NETWORK_ALIASES).filter((canon) =>
    NETWORK_ALIASES[canon].some((a) => lower.includes(a))
  );
  const tiers = Object.keys(TIER_ALIASES).filter((canon) =>
    TIER_ALIASES[canon].some((a) => lower.includes(a))
  );
  let inferred = null;
  if (networks.length && tiers.length) inferred = `${capFirst(networks[0])} ${capFirst(tiers[0])}`;
  else if (networks.length) inferred = `${capFirst(networks[0])}`;
  else if (tiers.length) inferred = `${capFirst(tiers[0])}`;

  return { base, variant: inferred };
}

function tokensOf(str) {
  return normalize(str).split(" ").filter(Boolean);
}

/** Damerau–Levenshtein */
function levenshtein(a, b) {
  a = normalize(a);
  b = normalize(b);
  const al = a.length;
  const bl = b.length;
  if (!al) return bl;
  if (!bl) return al;

  const dp = Array.from({ length: al + 1 }, () => Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) dp[i][0] = i;
  for (let j = 0; j <= bl; j++) dp[0][j] = j;

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[al][bl];
}

/** Score a candidate vs query tokens */
function scoreEntry(entry, qTokens) {
  let score = 0;
  const cand = normalize(entry.display);
  const candTokens = entry.tokens;

  // hard containment boost
  if (qTokens.length && qTokens.every((t) => cand.includes(t))) score += 30;

  // token similarity
  for (const qt of qTokens) {
    let best = 0;
    for (const ct of candTokens) {
      if (!ct) continue;
      if (ct === qt) best = Math.max(best, 12);
      else if (ct.startsWith(qt)) best = Math.max(best, 9);
      else {
        const d = levenshtein(qt, ct);
        const m = Math.max(qt.length, ct.length);
        const sim = 1 - d / m;
        if (sim > 0.6) best = Math.max(best, sim * 8);
      }
    }
    score += best;
  }

  score += Math.max(0, 6 - Math.min(6, entry.display.length / 20));
  return score;
}

/** Highlight tokens in dropdown text */
function highlightHtml(text, qTokens) {
  let out = escapeHtml(text);
  qTokens.forEach((t) => {
    if (!t) return;
    const re = new RegExp(`(${escapeRegExp(t)})`, "ig");
    out = out.replace(re, "<mark>$1</mark>");
  });
  return { __html: out };
}

/** tell which form matched: 'display' | 'base' | 'variant' | null */
function whichMatch(list, selectedDisplay, base, variant) {
  const norm = (s) => normalize(s);

  const targetDisplay = norm(selectedDisplay);
  const targetBase = norm(base);
  const variantForms = variant
    ? [
        `${base} ${variant}`,
        `${base} - ${variant}`,
        `${base} – ${variant}`,
        `${base} (${variant})`,
      ].map(norm)
    : [];

  for (const raw of list) {
    const v = norm(raw);
    if (v === targetDisplay) return { ok: true, mode: "display" };
    if (v === targetBase) return { ok: true, mode: "base" };
    if (variant && variantForms.includes(v)) return { ok: true, mode: "variant" };
  }
  return { ok: false, mode: null };
}

function makeEntry(display, type) {
  const { base, variant } = extractVariant(display);
  return {
    display: display.trim(),
    base: base.trim(),
    variant,
    type,
    tokens: tokensOf(display),
  };
}

/** ---------- DEDUP HELPERS (by image+title+desc+link) ---------- */
function normalizeUrl(u) {
  if (!u) return "";
  let s = String(u).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}
function normalizeText(s) {
  return normalize(s || "");
}
function offerKey(offer) {
  const image = normalizeUrl(firstField(offer, LIST_FIELDS.image) || "");
  const title = normalizeText(firstField(offer, LIST_FIELDS.title) || offer.Website || "");
  const desc = normalizeText(firstField(offer, LIST_FIELDS.desc) || "");
  const link = normalizeUrl(firstField(offer, LIST_FIELDS.link) || "");
  return `${title}||${desc}||${image}||${link}`;
}

/** wrappers look like: { offer, matchedVariant: boolean, site: string } */
function dedupWrapperArray(arr, seen) {
  const out = [];
  for (const w of arr || []) {
    const key = offerKey(w.offer);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/** -------------------- COMPONENT -------------------- */
const AirlineOffers = () => {
  // Entries for dropdown/search
  const [creditEntries, setCreditEntries] = useState([]);
  const [debitEntries, setDebitEntries] = useState([]);

  // UI states
  const [filteredCards, setFilteredCards] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedCard, setSelectedCard] = useState("");
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [isDebitCardSelected, setIsDebitCardSelected] = useState(false);
  const [noOffersMessage, setNoOffersMessage] = useState(false);

  // offers
  const [easeOffers, setEaseOffers] = useState([]);
  const [yatraDomesticOffers, setYatraDomesticOffers] = useState([]);
  const [yatraInternationalOffers, setYatraInternationalOffers] = useState([]);
  const [ixigoOffers, setIxigoOffers] = useState([]);
  const [airlineOffers, setAirlineOffers] = useState([]);
  const [makeMyTripOffers, setMakeMyTripOffers] = useState([]);
  const [clearTripOffers, setClearTripOffers] = useState([]);
  const [goibiboOffers, setGoibiboOffers] = useState([]);
  const [permanentOffers, setPermanentOffers] = useState([]);

  const buildGroupedList = (creditArr, debitArr, qTokens = []) => {
    const out = [];
    if (creditArr.length) {
      out.push({ type: "heading", label: "Credit Cards" });
      out.push(
        ...creditArr.map((entry) => ({
          type: "credit",
          entry,
          __html: highlightHtml(entry.base || entry.display, qTokens),
        }))
      );
    }
    if (debitArr.length) {
      out.push({ type: "heading", label: "Debit Cards" });
      out.push(
        ...debitArr.map((entry) => ({
          type: "debit",
          entry,
          __html: highlightHtml(entry.base || entry.display, qTokens),
        }))
      );
    }
    return out;
  };

  useEffect(() => {
    const fetchCSVData = async () => {
      try {
        const files = [
          { name: "EASE MY TRIP AIRLINE.csv", setter: setEaseOffers },
          { name: "YATRA AIRLINE DOMESTIC.csv", setter: setYatraDomesticOffers },
          { name: "YATRA AIRLINE INTERNATIONAL.csv", setter: setYatraInternationalOffers },
          { name: "IXIGO AIRLINE.csv", setter: setIxigoOffers },
          { name: "Airline-offers.csv", setter: setAirlineOffers },
          { name: "MAKE MY TRIP.csv", setter: setMakeMyTripOffers },
          { name: "CLEAR TRIP.csv", setter: setClearTripOffers },
          { name: "GOIBIBO AIRLINE.csv", setter: setGoibiboOffers },
          { name: "Updated_Permanent_Offers.csv", setter: setPermanentOffers },
        ];

        const allCreditCards = new Set();
        const allDebitCards = new Set();

        for (const file of files) {
          const response = await axios.get(`/${file.name}`);
          const parsed = Papa.parse(response.data, { header: true });
          const rows = parsed.data || [];

          for (const row of rows) {
            const ccList = splitList(firstField(row, LIST_FIELDS.credit));
            ccList.forEach((c) => allCreditCards.add(c));

            const dcList = splitList(firstField(row, LIST_FIELDS.debit));
            dcList.forEach((d) => allDebitCards.add(d));

            const ccName = firstField(row, LIST_FIELDS.permanentCCName);
            if (ccName) allCreditCards.add(String(ccName).trim());
          }

          file.setter(rows);
        }

        const ccSorted = Array.from(allCreditCards).filter(Boolean).sort((a, b) => a.localeCompare(b));
        const dcSorted = Array.from(allDebitCards).filter(Boolean).sort((a, b) => a.localeCompare(b));

        const creditEntriesBuilt = ccSorted.map((d) => makeEntry(d, "credit"));
        const debitEntriesBuilt = dcSorted.map((d) => makeEntry(d, "debit"));
        setCreditEntries(creditEntriesBuilt);
        setDebitEntries(debitEntriesBuilt);

        // IMPORTANT: no pre-populated dropdown when input is empty
        setFilteredCards([]);
      } catch (error) {
        console.error("Error loading CSV data:", error);
      }
    };

    fetchCSVData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rankAndFilter = (entries, qTokens) => {
    if (!qTokens.length) return [];
    const scored = entries
      .map((e) => ({ e, s: scoreEntry(e, qTokens) }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => (b.s - a.s) || a.e.display.localeCompare(b.e.display))
      .slice(0, MAX_SUGGESTIONS)
      .map(({ e }) => e);
    return scored;
  };

  const handleInputChange = (event) => {
    const value = event.target.value;
    setQuery(value);

    // If input is empty → clear dropdown and previously shown offers
    if (!value.trim()) {
      setFilteredCards([]);
      setNoOffersMessage(false);
      setSelectedCard("");
      setSelectedEntry(null);
      setIsDebitCardSelected(false);
      return; // <— stop here so nothing shows
    }

    const qTokens = tokensOf(value);
    const rankedCredit = rankAndFilter(creditEntries, qTokens);
    const rankedDebit = rankAndFilter(debitEntries, qTokens);

    const combined = buildGroupedList(rankedCredit, rankedDebit, qTokens);
    setFilteredCards(combined);

    if (!rankedCredit.length && !rankedDebit.length) {
      setNoOffersMessage(true);
      setSelectedCard("");
      setSelectedEntry(null);
    } else {
      setNoOffersMessage(false);
    }
  };

  const handleCardSelection = (entry, type) => {
    setSelectedCard(entry.display);        // keep full text for matching
    setSelectedEntry(entry);
    setQuery(entry.base || entry.display); // show only base in textbox
    setFilteredCards([]);                  // close dropdown
    setNoOffersMessage(false);
    setIsDebitCardSelected(type === "debit");
  };

  /** Returns wrappers: { offer, matchedVariant: boolean, site: string } */
  const getOffersForSelectedCard = (offers, isDebit = false, isPermanent = false, siteName = "") => {
    if (!selectedEntry) return [];
    const { display, base, variant } = selectedEntry;

    const out = [];
    for (const offer of (offers || [])) {
      if (isPermanent) {
        const ccName = firstField(offer, LIST_FIELDS.permanentCCName);
        if (!ccName) continue;
        const { ok, mode } = whichMatch([ccName], display, base, variant);
        if (!ok) continue;
        out.push({ offer, matchedVariant: mode === "variant", site: siteName });
        continue;
      }

      const list = splitList(firstField(offer, isDebit ? LIST_FIELDS.debit : LIST_FIELDS.credit));
      const { ok, mode } = whichMatch(list, display, base, variant);
      if (!ok) continue;
      out.push({ offer, matchedVariant: mode === "variant", site: siteName });
    }
    return out;
  };

  // Build selections
  const sEase      = getOffersForSelectedCard(easeOffers, isDebitCardSelected, false, "EaseMyTrip");
  const sYatraDom  = getOffersForSelectedCard(yatraDomesticOffers, isDebitCardSelected, false, "Yatra (Domestic)");
  const sYatraInt  = getOffersForSelectedCard(yatraInternationalOffers, isDebitCardSelected, false, "Yatra (International)");
  const sIxigo     = getOffersForSelectedCard(ixigoOffers, isDebitCardSelected, false, "Ixigo");
  const sAirline   = getOffersForSelectedCard(airlineOffers, isDebitCardSelected, false, "Airline");
  const sMMT       = getOffersForSelectedCard(makeMyTripOffers, isDebitCardSelected, false, "MakeMyTrip");
  const sClearTrip = getOffersForSelectedCard(clearTripOffers, isDebitCardSelected, false, "ClearTrip");
  const sGoibibo   = getOffersForSelectedCard(goibiboOffers, isDebitCardSelected, false, "Goibibo");
  const sPermanent = getOffersForSelectedCard(permanentOffers, false, true, "Permanent");

  // global de-dupe (keep first by this priority)
  const seenKeys = new Set();
  const dPermanent = !isDebitCardSelected ? dedupWrapperArray(sPermanent, seenKeys) : [];
  const dAirline   = dedupWrapperArray(sAirline, seenKeys);
  const dGoibibo   = dedupWrapperArray(sGoibibo, seenKeys);
  const dEase      = dedupWrapperArray(sEase, seenKeys);
  const dYatraDom  = dedupWrapperArray(sYatraDom, seenKeys);
  const dYatraInt  = dedupWrapperArray(sYatraInt, seenKeys);
  const dIxigo     = dedupWrapperArray(sIxigo, seenKeys);
  const dMMT       = dedupWrapperArray(sMMT, seenKeys);
  const dClearTrip = dedupWrapperArray(sClearTrip, seenKeys);

  const hasAnyOffers =
    dPermanent.length > 0 ||
    dAirline.length > 0 ||
    dGoibibo.length > 0 ||
    dEase.length > 0 ||
    dYatraDom.length > 0 ||
    dYatraInt.length > 0 ||
    dIxigo.length > 0 ||
    dMMT.length > 0 ||
    dClearTrip.length > 0;

  const showScrollButton = hasAnyOffers;

  const handleScrollDown = () => {
    window.scrollBy({ top: window.innerHeight, behavior: "smooth" });
  };

  // Offer card
  const OfferCard = ({ offer, showVariantNote, variantText, isPermanentCard = false }) => {
    const image = firstField(offer, LIST_FIELDS.image);
    const title = firstField(offer, LIST_FIELDS.title) || offer.Website || "Offer";
    const desc  = firstField(offer, LIST_FIELDS.desc);
    const link  = firstField(offer, LIST_FIELDS.link);

    return (
      <div className="offer-card">
        {image && <img src={image} alt={title} />}
        <div className="offer-info">
          <h3>{title}</h3>
          {desc && <p>{desc}</p>}

          {showVariantNote && variantText && (
            <div style={{ margin: "6px 0 10px", fontSize: 14 }}>
              <strong>Note:</strong> This benefit is applicable only on <em>{variantText}</em> variant
            </div>
          )}

          {isPermanentCard && (
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              This is a inbuilt feature of this credit card
            </div>
          )}

          {link && (
            <button onClick={() => window.open(link, "_blank")}>
              View Offer
            </button>
          )}
        </div>
      </div>
    );
  };

  // Centered section title (like your screenshot)
  const Section = ({ title, children }) => (
    <div style={{ margin: "28px auto 18px", maxWidth: 1200 }}>
      <h2
        style={{
          textAlign: "center",
          fontSize: "42px",
          margin: "0 0 18px 0",
          fontWeight: 700,
        }}
      >
        {title}
      </h2>
      <div className="offer-grid">{children}</div>
    </div>
  );

  return (
    <div className="App" style={{ fontFamily: "'Libre Baskerville', serif" }}>
      {/* Search */}
      <div className="dropdown" style={{ position: "relative", width: "600px", margin: "24px auto 8px" }}>
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          placeholder="Type a Credit or Debit Card..."
          style={{
            width: "100%",
            padding: "12px",
            fontSize: "16px",
            border: "1px solid #ccc",
            borderRadius: "5px",
          }}
        />

        {/* Dropdown only if user typed AND we have results */}
        {query.trim() && filteredCards.length > 0 && (
          <ul
            style={{
              listStyleType: "none",
              padding: "10px",
              margin: 0,
              width: "100%",
              maxHeight: "240px",
              overflowY: "auto",
              border: "1px solid #ccc",
              borderRadius: "5px",
              backgroundColor: "#fff",
              position: "absolute",
              zIndex: 1000,
            }}
          >
            {filteredCards.map((item, index) =>
              item.type === "heading" ? (
                <li key={`h-${index}`} style={{ padding: "10px", fontWeight: "bold", background: "#fafafa" }}>
                  {item.label}
                </li>
              ) : (
                <li
                  key={`i-${index}-${item.entry.display}`}
                  onClick={() => handleCardSelection(item.entry, item.type)}
                  style={{
                    padding: "10px",
                    cursor: "pointer",
                    borderBottom: index !== filteredCards.length - 1 ? "1px solid #eee" : "none",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f5f7fb")}
                  onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <span dangerouslySetInnerHTML={item.__html} />
                </li>
              )
            )}
          </ul>
        )}
      </div>

      {noOffersMessage && query.trim() && (
        <p style={{ color: "red", textAlign: "center", marginTop: "10px" }}>
          No matching cards found. Try including part of the card name.
        </p>
      )}

      {/* Offers */}
      {selectedCard && hasAnyOffers && (
        <div className="offers-section" style={{ maxWidth: "1200px", margin: "0 auto", padding: "8px 20px 24px" }}>
          {!isDebitCardSelected && dPermanent.length > 0 && (
            <Section title="Permanent Offers">
              {dPermanent.map((w, idx) => (
                <OfferCard
                  key={`perm-${idx}`}
                  offer={w.offer}
                  showVariantNote={w.matchedVariant && SHOW_VARIANT_NOTE_SITES.has(w.site)}
                  variantText={selectedEntry?.variant}
                  isPermanentCard
                />
              ))}
            </Section>
          )}

          {dAirline.length > 0 && (
            <Section title="Airline Offers">
              {dAirline.map((w, idx) => (
                <OfferCard
                  key={`air-${idx}`}
                  offer={w.offer}
                  showVariantNote={w.matchedVariant && SHOW_VARIANT_NOTE_SITES.has(w.site)}
                  variantText={selectedEntry?.variant}
                />
              ))}
            </Section>
          )}

          {dGoibibo.length > 0 && (
            <Section title="Goibibo Offers">
              {dGoibibo.map((w, idx) => (
                <OfferCard
                  key={`go-${idx}`}
                  offer={w.offer}
                  showVariantNote={w.matchedVariant && SHOW_VARIANT_NOTE_SITES.has(w.site)}
                  variantText={selectedEntry?.variant}
                />
              ))}
            </Section>
          )}

          {dEase.length > 0 && (
            <Section title="EaseMyTrip Offers">
              {dEase.map((w, idx) => (
                <OfferCard
                  key={`emt-${idx}`}
                  offer={w.offer}
                  showVariantNote={w.matchedVariant && SHOW_VARIANT_NOTE_SITES.has(w.site)}
                  variantText={selectedEntry?.variant}
                />
              ))}
            </Section>
          )}

          {dYatraDom.length > 0 && (
            <Section title="Yatra (Domestic) Offers">
              {dYatraDom.map((w, idx) => (
                <OfferCard
                  key={`y-dom-${idx}`}
                  offer={w.offer}
                  showVariantNote={w.matchedVariant && SHOW_VARIANT_NOTE_SITES.has(w.site)}
                  variantText={selectedEntry?.variant}
                />
              ))}
            </Section>
          )}

          {dYatraInt.length > 0 && (
            <Section title="Yatra (International) Offers">
              {dYatraInt.map((w, idx) => (
                <OfferCard
                  key={`y-int-${idx}`}
                  offer={w.offer}
                  showVariantNote={w.matchedVariant && SHOW_VARIANT_NOTE_SITES.has(w.site)}
                  variantText={selectedEntry?.variant}
                />
              ))}
            </Section>
          )}

          {dIxigo.length > 0 && (
            <Section title="Ixigo Offers">
              {dIxigo.map((w, idx) => (
                <OfferCard
                  key={`ix-${idx}`}
                  offer={w.offer}
                  showVariantNote={w.matchedVariant && SHOW_VARIANT_NOTE_SITES.has(w.site)}
                  variantText={selectedEntry?.variant}
                />
              ))}
            </Section>
          )}

          {dMMT.length > 0 && (
            <Section title="MakeMyTrip Offers">
              {dMMT.map((w, idx) => (
                <OfferCard
                  key={`mmt-${idx}`}
                  offer={w.offer}
                  showVariantNote={w.matchedVariant && SHOW_VARIANT_NOTE_SITES.has(w.site)}
                  variantText={selectedEntry?.variant}
                />
              ))}
            </Section>
          )}

          {dClearTrip.length > 0 && (
            <Section title="ClearTrip Offers">
              {dClearTrip.map((w, idx) => (
                <OfferCard
                  key={`ct-${idx}`}
                  offer={w.offer}
                  showVariantNote={w.matchedVariant && SHOW_VARIANT_NOTE_SITES.has(w.site)}
                  variantText={selectedEntry?.variant}
                />
              ))}
            </Section>
          )}
        </div>
      )}

      {showScrollButton && (
        <button
          onClick={handleScrollDown}
          style={{
            position: "fixed",
            right: "20px",
            bottom: "150px",
            padding: "10px 15px",
            backgroundColor: "#1e7145",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "16px",
            zIndex: 1000,
            boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
          }}
        >
          Scroll Down
        </button>
      )}
    </div>
  );
};

export default AirlineOffers;
