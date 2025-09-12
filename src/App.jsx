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

/** Show the red note for all 7 OTA sections */
const SHOW_VARIANT_NOTE_SITES = new Set([
  "EaseMyTrip",
  "Yatra (Domestic)",
  "Yatra (International)",
  "Ixigo",
  "MakeMyTrip",
  "ClearTrip",
  "Goibibo",
]);

/** -------------------- HELPERS (mirrors hotel code rules) -------------------- */
function firstField(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = obj[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
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
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Canonical casing for common brands so
 *  “Makemytrip …” and “MakeMyTrip …” collapse into one dropdown entry. */
function canonicalBrandCase(str) {
  return String(str)
    .replace(/makemytrip/gi, "MakeMyTrip")
    .replace(/\bcleartrip\b/gi, "ClearTrip")
    .replace(/\beasemytrip\b/gi, "EaseMyTrip")
    .replace(/\bgoibibo\b/gi, "Goibibo")
    .replace(/\byatra\b/gi, "Yatra")
    .replace(/\bicici\b/gi, "ICICI")
    .replace(/\bhdfc\b/gi, "HDFC")
    .replace(/\bsbi\b/gi, "SBI")
    .replace(/\baxis\b/gi, "Axis")
    .replace(/\bkotak\b/gi, "Kotak");
}

/** STRICT hotel-like rules:
 * variant = ONLY text inside a trailing (...) at the END of the card string.
 * base    = the name with that trailing (...) removed.
 */
function getBaseCardName(name) {
  if (!name) return "";
  return String(name).replace(/\s*\([^)]*\)\s*$/, "").trim();
}
function getNetworkVariant(name) {
  if (!name) return "";
  const m = String(name).match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : "";
}

/** Canonical key used for matching (base only, case/space-insensitive) */
function canonicalKey(name) {
  return normalize(getBaseCardName(name)).replace(/\s+/g, "");
}

/** --- Offer dedup key (image + title + desc + link) --- */
function normalizeUrl(u) {
  if (!u) return "";
  let s = String(u).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}
function normalizeText(s) { return normalize(s || ""); }
function offerKey(offer) {
  const image = normalizeUrl(firstField(offer, LIST_FIELDS.image) || "");
  const title = normalizeText(firstField(offer, LIST_FIELDS.title) || offer.Website || "");
  const desc  = normalizeText(firstField(offer, LIST_FIELDS.desc) || "");
  const link  = normalizeUrl(firstField(offer, LIST_FIELDS.link) || "");
  return `${title}||${desc}||${image}||${link}`;
}
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

/** -------------------- DROPDOWN RANKING -------------------- */
function tokensOf(str) { return normalize(str).split(" ").filter(Boolean); }
function levenshtein(a, b) {
  a = normalize(a); b = normalize(b);
  const al = a.length, bl = b.length;
  if (!al) return bl; if (!bl) return al;
  const dp = Array.from({ length: al + 1 }, () => Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) dp[i][0] = i;
  for (let j = 0; j <= bl; j++) dp[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[al][bl];
}
function scoreEntry(entry, qTokens) {
  if (!qTokens.length) return 1;
  let score = 0;
  const cand = normalize(entry.display);
  const candTokens = entry.tokens;
  let allContain = true;
  for (const t of qTokens) { if (!cand.includes(t)) { allContain = false; break; } }
  if (allContain) score += 30;

  for (const qt of qTokens) {
    let best = 0;
    for (const ct of candTokens) {
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
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function highlightHtml(text, qTokens) {
  let out = escapeHtml(text);
  qTokens.forEach((t) => {
    if (!t) return;
    const re = new RegExp(`(${escapeRegExp(t)})`, "ig");
    out = out.replace(re, "<mark>$1</mark>");
  });
  return { __html: out };
}

/** Build dropdown entry (canonical display = base without variant) */
function makeEntry(nameRaw, type) {
  const base = getBaseCardName(nameRaw);
  const display = canonicalBrandCase(base);
  return { display, base, type, tokens: tokensOf(display) };
}

/** EXACT hotel-like matching:
 *  - We match by base (case/space-insensitive).
 *  - If the *list item* has a trailing (Variant), we return that variant
 *    so the card can show the red note.
 */
function matchItemAgainstSelected(listItem, selectedBase) {
  const itemBaseKey = canonicalKey(listItem);
  const selBaseKey  = canonicalKey(selectedBase);
  if (itemBaseKey !== selBaseKey) return { ok: false, variantText: "" };

  const variant = getNetworkVariant(listItem); // ONLY trailing (...) counts
  return { ok: true, variantText: variant || "" };
}

/** -------------------- COMPONENT -------------------- */
const AirlineOffers = () => {
  // dropdown entries
  const [creditEntries, setCreditEntries] = useState([]);
  const [debitEntries, setDebitEntries] = useState([]);

  // UI
  const [filteredCards, setFilteredCards] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedCard, setSelectedCard] = useState("");
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [isDebitCardSelected, setIsDebitCardSelected] = useState(false);
  const [noOffersMessage, setNoOffersMessage] = useState(false);

  // offers
  const [easeOffers, setEaseOffers] = useState([]);
  const [yatraDom, setYatraDom] = useState([]);
  const [yatraInt, setYatraInt] = useState([]);
  const [ixigo, setIxigo] = useState([]);
  const [airline, setAirline] = useState([]);
  const [mmt, setMMT] = useState([]);
  const [clearTrip, setClearTrip] = useState([]);
  const [goibibo, setGoibibo] = useState([]);
  const [permanent, setPermanent] = useState([]);

  // group list for dropdown
  const buildGroupedList = (creditArr, debitArr, qTokens = []) => {
    const out = [];
    if (creditArr.length) {
      out.push({ type: "heading", label: "Credit Cards" });
      out.push(...creditArr.map((entry) => ({
        type: "credit",
        entry,
        __html: highlightHtml(entry.display, qTokens),
      })));
    }
    if (debitArr.length) {
      out.push({ type: "heading", label: "Debit Cards" });
      out.push(...debitArr.map((entry) => ({
        type: "debit",
        entry,
        __html: highlightHtml(entry.display, qTokens),
      })));
    }
    return out;
  };

  useEffect(() => {
    const fetchCSVData = async () => {
      try {
        const files = [
          { name: "EASE MY TRIP AIRLINE.csv", setter: setEaseOffers },
          { name: "YATRA AIRLINE DOMESTIC.csv", setter: setYatraDom },
          { name: "YATRA AIRLINE INTERNATIONAL.csv", setter: setYatraInt },
          { name: "IXIGO AIRLINE.csv", setter: setIxigo },
          { name: "Airline-offers.csv", setter: setAirline },
          { name: "MAKE MY TRIP.csv", setter: setMMT },
          { name: "CLEAR TRIP.csv", setter: setClearTrip },
          { name: "GOIBIBO AIRLINE.csv", setter: setGoibibo },
          { name: "Updated_Permanent_Offers.csv", setter: setPermanent },
        ];

        // Build canonical dropdown sets using maps (base only)
        const creditMap = new Map();
        const debitMap  = new Map();

        for (const f of files) {
          const resp = await axios.get(`/${f.name}`);
          const parsed = Papa.parse(resp.data, { header: true });
          const rows = parsed.data || [];

          for (const row of rows) {
            splitList(firstField(row, LIST_FIELDS.credit)).forEach((c) => {
              const base = getBaseCardName(c);
              const key = canonicalKey(base);
              if (!creditMap.has(key)) creditMap.set(key, canonicalBrandCase(base));
            });
            splitList(firstField(row, LIST_FIELDS.debit)).forEach((d) => {
              const base = getBaseCardName(d);
              const key = canonicalKey(base);
              if (!debitMap.has(key)) debitMap.set(key, canonicalBrandCase(base));
            });

            const ccName = firstField(row, LIST_FIELDS.permanentCCName);
            if (ccName) {
              const base = getBaseCardName(ccName);
              const key = canonicalKey(base);
              if (!creditMap.has(key)) creditMap.set(key, canonicalBrandCase(base));
            }
          }

          f.setter(rows);
        }

        const creditEntriesBuilt = [...creditMap.values()]
          .sort((a, b) => a.localeCompare(b))
          .map((name) => makeEntry(name, "credit"));
        const debitEntriesBuilt = [...debitMap.values()]
          .sort((a, b) => a.localeCompare(b))
          .map((name) => makeEntry(name, "debit"));

        setCreditEntries(creditEntriesBuilt);
        setDebitEntries(debitEntriesBuilt);
        setFilteredCards(buildGroupedList(creditEntriesBuilt, debitEntriesBuilt, []));
      } catch (e) {
        console.error("Error loading CSV:", e);
      }
    };

    fetchCSVData();
  }, []);

  const rankAndFilter = (entries, qTokens) => {
    if (!qTokens.length) return entries.slice(0, MAX_SUGGESTIONS);
    return entries
      .map((e) => ({ e, s: scoreEntry(e, qTokens) }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => (b.s - a.s) || a.e.display.localeCompare(b.e.display))
      .slice(0, MAX_SUGGESTIONS)
      .map(({ e }) => e);
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    const qTokens = tokensOf(value);
    if (value.trim()) {
      const combined = buildGroupedList(
        rankAndFilter(creditEntries, qTokens),
        rankAndFilter(debitEntries, qTokens),
        qTokens
      );
      setFilteredCards(combined);
      setNoOffersMessage(combined.filter((i) => i.type !== "heading").length === 0);
    } else {
      setFilteredCards(buildGroupedList(creditEntries, debitEntries, []));
      setNoOffersMessage(false);
      setSelectedCard("");
      setSelectedEntry(null);
    }
  };

  const handleCardSelection = (entry, type) => {
    setSelectedCard(entry.display);
    setSelectedEntry(entry);
    setQuery(entry.display);
    setFilteredCards([]);
    setNoOffersMessage(false);
    setIsDebitCardSelected(type === "debit");
  };

  /** Return wrappers like hotel code: { offer, variantText, site }.
   *  variantText is taken from the EXACT list item that matched (ONLY if trailing (...)).
   */
  const getOffersForSelectedCard = (offers, isDebit = false, isPermanent = false, siteName = "") => {
    if (!selectedEntry) return [];
    const out = [];
    for (const offer of (offers || [])) {
      if (isPermanent) {
        const ccName = firstField(offer, LIST_FIELDS.permanentCCName);
        if (!ccName) continue;
        const { ok, variantText } = matchItemAgainstSelected(ccName, selectedEntry.base);
        if (!ok) continue;
        out.push({ offer, variantText, site: siteName });
        continue;
      }

      const list = splitList(firstField(offer, isDebit ? LIST_FIELDS.debit : LIST_FIELDS.credit));
      let matched = false;
      let variantText = "";
      for (const item of list) {
        const res = matchItemAgainstSelected(item, selectedEntry.base);
        if (res.ok) {
          matched = true;
          // prefer first non-empty variant encountered
          if (res.variantText && !variantText) variantText = res.variantText;
        }
      }
      if (matched) out.push({ offer, variantText, site: siteName });
    }
    return out;
  };

  // collect all sections
  const sEase  = getOffersForSelectedCard(easeOffers, isDebitCardSelected, false, "EaseMyTrip");
  const sYDom  = getOffersForSelectedCard(yatraDom,  isDebitCardSelected, false, "Yatra (Domestic)");
  const sYInt  = getOffersForSelectedCard(yatraInt,  isDebitCardSelected, false, "Yatra (International)");
  const sIxigo = getOffersForSelectedCard(ixigo,     isDebitCardSelected, false, "Ixigo");
  const sAir   = getOffersForSelectedCard(airline,   isDebitCardSelected, false, "Airline");
  const sMMT   = getOffersForSelectedCard(mmt,       isDebitCardSelected, false, "MakeMyTrip");
  const sCT    = getOffersForSelectedCard(clearTrip, isDebitCardSelected, false, "ClearTrip");
  const sGoi   = getOffersForSelectedCard(goibibo,   isDebitCardSelected, false, "Goibibo");
  const sPerm  = getOffersForSelectedCard(permanent, false, true, "Permanent");

  // global dedup by priority
  const seen = new Set();
  const dPerm = !isDebitCardSelected ? dedupWrapperArray(sPerm, seen) : [];
  const dAir  = dedupWrapperArray(sAir,  seen);
  const dGoi  = dedupWrapperArray(sGoi,  seen);
  const dEase = dedupWrapperArray(sEase, seen);
  const dYDom = dedupWrapperArray(sYDom, seen);
  const dYInt = dedupWrapperArray(sYInt, seen);
  const dIxi  = dedupWrapperArray(sIxigo, seen);
  const dMMT  = dedupWrapperArray(sMMT, seen);
  const dCT   = dedupWrapperArray(sCT,  seen);

  const hasAny =
    dPerm.length || dAir.length || dGoi.length || dEase.length ||
    dYDom.length || dYInt.length || dIxi.length || dMMT.length || dCT.length;

  const OfferCard = ({ offer, variantText }) => {
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

          {/* EXACTLY like hotel: only show when trailing (...) was present in matched list item */}
          {variantText && (
            <div style={{ color: "#d32f2f", fontWeight: 600, margin: "8px 0" }}>
              Applicable only on <em>{variantText}</em> variant
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

  return (
    <div className="App" style={{ fontFamily: "'Libre Baskerville', serif" }}>
      {/* Dropdown */}
      <div className="dropdown" style={{ position: "relative", width: "600px", margin: "2px auto" }}>
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          placeholder="Type a Credit or Debit Card..."
          style={{ width: "100%", padding: 12, fontSize: 16, border: "1px solid #ccc", borderRadius: 5 }}
        />

        {filteredCards.length > 0 && (
          <ul style={{
            listStyleType: "none", padding: 10, margin: 0, width: "100%",
            maxHeight: 240, overflowY: "auto", border: "1px solid #ccc",
            borderRadius: 5, backgroundColor: "#fff", position: "absolute", zIndex: 1000
          }}>
            {filteredCards.map((item, index) =>
              item.type === "heading" ? (
                <li key={`h-${index}`} style={{ padding: "10px", fontWeight: "bold", background: "#fafafa" }}>
                  {item.label}
                </li>
              ) : (
                <li
                  key={`i-${index}-${item.entry.display}`}
                  onClick={() => {
                    setSelectedCard(item.entry.display);
                    setSelectedEntry(item.entry);
                    setIsDebitCardSelected(item.type === "debit");
                    setQuery(item.entry.display);
                    setFilteredCards([]);
                    setNoOffersMessage(false);
                  }}
                  style={{
                    padding: "10px",
                    cursor: "pointer",
                    borderBottom: index !== filteredCards.length - 1 ? "1px solid #eee" : "none",
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

      {noOffersMessage && (
        <p style={{ color: "red", textAlign: "center", marginTop: 10 }}>
          No matching cards found. Try including part of the card name.
        </p>
      )}

      {selectedCard && hasAny && (
        <div className="offers-section" style={{ maxWidth: "1200px", margin: "0 auto", padding: "20px" }}>
          {!isDebitCardSelected && dPerm.length > 0 && (
            <div>
              <h2>Permanent Offers</h2>
              <div className="offer-grid">
                {dPerm.map((w, idx) => (
                  <OfferCard key={`p-${idx}`} offer={w.offer} variantText={w.variantText} />
                ))}
              </div>
            </div>
          )}

          {dAir.length > 0 && (
            <div>
              <h2>Airline Offers</h2>
              <div className="offer-grid">
                {dAir.map((w, idx) => (
                  <OfferCard key={`air-${idx}`} offer={w.offer} variantText={w.variantText} />
                ))}
              </div>
            </div>
          )}

          {dGoi.length > 0 && (
            <div>
              <h2>Offers on Goibibo</h2>
              <div className="offer-grid">
                {dGoi.map((w, idx) => (
                  <OfferCard key={`go-${idx}`} offer={w.offer} variantText={w.variantText} />
                ))}
              </div>
            </div>
          )}

          {dEase.length > 0 && (
            <div>
              <h2>Offers on EaseMyTrip</h2>
              <div className="offer-grid">
                {dEase.map((w, idx) => (
                  <OfferCard key={`emt-${idx}`} offer={w.offer} variantText={w.variantText} />
                ))}
              </div>
            </div>
          )}

          {dYDom.length > 0 && (
            <div>
              <h2>Offers on Yatra (Domestic)</h2>
              <div className="offer-grid">
                {dYDom.map((w, idx) => (
                  <OfferCard key={`yd-${idx}`} offer={w.offer} variantText={w.variantText} />
                ))}
              </div>
            </div>
          )}

          {dYInt.length > 0 && (
            <div>
              <h2>Offers on Yatra (International)</h2>
              <div className="offer-grid">
                {dYInt.map((w, idx) => (
                  <OfferCard key={`yi-${idx}`} offer={w.offer} variantText={w.variantText} />
                ))}
              </div>
            </div>
          )}

          {dIxi.length > 0 && (
            <div>
              <h2>Offers on Ixigo</h2>
              <div className="offer-grid">
                {dIxi.map((w, idx) => (
                  <OfferCard key={`ix-${idx}`} offer={w.offer} variantText={w.variantText} />
                ))}
              </div>
            </div>
          )}

          {dMMT.length > 0 && (
            <div>
              <h2>Offers on MakeMyTrip</h2>
              <div className="offer-grid">
                {dMMT.map((w, idx) => (
                  <OfferCard key={`mmt-${idx}`} offer={w.offer} variantText={w.variantText} />
                ))}
              </div>
            </div>
          )}

          {dCT.length > 0 && (
            <div>
              <h2>Offers on ClearTrip</h2>
              <div className="offer-grid">
                {dCT.map((w, idx) => (
                  <OfferCard key={`ct-${idx}`} offer={w.offer} variantText={w.variantText} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AirlineOffers;
