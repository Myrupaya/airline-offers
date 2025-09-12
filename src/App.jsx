import React, { useEffect, useState } from "react";
import axios from "axios";
import Papa from "papaparse";
import "./App.css";

/** -------------------- CONFIG -------------------- */
const LIST_FIELDS = {
  // multi-source field names
  credit: ["Eligible Credit Cards", "Eligible Cards"],
  debit: ["Eligible Debit Cards", "Applicable Debit Cards"],
  title: ["Offer Title", "Title"],
  image: ["Image", "Credit Card Image", "Offer Image"],
  link: ["Link", "Offer Link"],
  desc: ["Description", "Details", "Offer Description", "Flight Benefit"],
  permanentCCName: ["Credit Card Name"],
  permanentBenefit: ["Flight Benefit", "Benefit", "Offer", "Hotel Benefit"],
};

const MAX_SUGGESTIONS = 50;

/** Sites where we want the red per-card “Applicable only on {variant} variant” note */
const VARIANT_NOTE_SITES = new Set([
  "EaseMyTrip",
  "Yatra (Domestic)",
  "Yatra (International)",
  "Ixigo",
  "MakeMyTrip",
  "ClearTrip",
  "Goibibo",
  "Airline",     // generic airline csv (optional but helpful)
  "Permanent",   // show as well for permanent cards (when present)
]);

/** -------------------- HELPERS -------------------- */
const toNorm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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
    .replace(/\n/g, " ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Extract base name (strip trailing (...) ) */
function getBase(name) {
  if (!name) return "";
  return String(name).replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Variant ONLY if in parentheses at the end:  "… (Visa Signature)" → "Visa Signature" */
function getVariant(name) {
  if (!name) return "";
  const m = String(name).match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : "";
}

/** Small brand canonicalizer so “Makemytrip” → “MakeMyTrip”, “ICICI” stays ICICI, etc. */
function brandCanonicalize(text) {
  let s = String(text || "");
  s = s.replace(/\bMakemytrip\b/gi, "MakeMyTrip");
  s = s.replace(/\bIcici\b/gi, "ICICI");
  s = s.replace(/\bHdfc\b/gi, "HDFC");
  s = s.replace(/\bSbi\b/gi, "SBI");
  s = s.replace(/\bIdfc\b/gi, "IDFC");
  s = s.replace(/\bPnb\b/gi, "PNB");
  s = s.replace(/\bRbl\b/gi, "RBL");
  s = s.replace(/\bYes\b/gi, "YES");
  return s;
}

/** Levenshtein distance (for fuzzy ranking) */
function lev(a, b) {
  a = toNorm(a);
  b = toNorm(b);
  const n = a.length,
    m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[n][m];
}

function scoreCandidate(q, cand) {
  const qs = toNorm(q);
  const cs = toNorm(cand);
  if (!qs) return 0;
  if (cs.includes(qs)) return 100;

  const qWords = qs.split(" ").filter(Boolean);
  const cWords = cs.split(" ").filter(Boolean);

  const matchingWords = qWords.filter((qw) => cWords.some((cw) => cw.includes(qw))).length;
  const sim = 1 - lev(qs, cs) / Math.max(qs.length, cs.length);
  return (matchingWords / Math.max(1, qWords.length)) * 0.7 + sim * 0.3;
}

/** Build a pretty dropdown entry */
function makeEntry(raw, type) {
  const base = brandCanonicalize(getBase(raw));
  return {
    type,
    display: base, // we show only base in dropdown
    baseNorm: toNorm(base),
  };
}

function normalizeUrl(u) {
  if (!u) return "";
  let s = String(u).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}
function normalizeText(s) {
  return toNorm(s || "");
}
function offerKey(offer) {
  const image = normalizeUrl(firstField(offer, LIST_FIELDS.image) || "");
  const title = normalizeText(firstField(offer, LIST_FIELDS.title) || offer.Website || "");
  const desc = normalizeText(firstField(offer, LIST_FIELDS.desc) || "");
  const link = normalizeUrl(firstField(offer, LIST_FIELDS.link) || "");
  return `${title}||${desc}||${image}||${link}`;
}

/** Dedup wrappers (keep first by priority) */
function dedupWrappers(arr, seen) {
  const out = [];
  for (const w of arr || []) {
    const k = offerKey(w.offer);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

/** Disclaimer component */
const Disclaimer = () => (
  <section className="disclaimer">
    <h3>Disclaimer</h3>
    <p>
      All offers, coupons, and discounts listed on our platform are provided for informational purposes only.
      We do not guarantee the accuracy, availability, or validity of any offer. Users are advised to verify the
      terms and conditions with the respective merchants before making any purchase. We are not responsible for any
      discrepancies, expired offers, or losses arising from the use of these coupons.
    </p>
  </section>
);

/** -------------------- COMPONENT -------------------- */
const AirlineOffers = () => {
  // dropdown data
  const [creditEntries, setCreditEntries] = useState([]);
  const [debitEntries, setDebitEntries] = useState([]);

  // ui state
  const [filteredCards, setFilteredCards] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null); // {type, display, baseNorm}
  const [noMatches, setNoMatches] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

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

  // responsive
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // load csvs + build dropdown sets (dedup by base)
  useEffect(() => {
    async function load() {
      try {
        const files = [
          { name: "easeMyTrip.csv", setter: setEaseOffers },
          { name: "yatraDomestic.csv", setter: setYatraDomesticOffers },
          { name: "yatraInternational.csv", setter: setYatraInternationalOffers },
          { name: "ixigo.csv", setter: setIxigoOffers },
          
          { name: "makemytrip.csv", setter: setMakeMyTripOffers },
          { name: "cleartrip.csv", setter: setClearTripOffers },
          { name: "goibibo.csv", setter: setGoibiboOffers },
          { name: "permanent.csv", setter: setPermanentOffers },
        ];

        const creditMap = new Map(); // baseNorm -> display (canonical)
        const debitMap = new Map();

        for (const f of files) {
          const res = await axios.get(`/${encodeURIComponent(f.name)}`);


          const parsed = Papa.parse(res.data, { header: true });
          const rows = parsed.data || [];

          // collect names
          for (const row of rows) {
            // credit lists
            const ccList = splitList(firstField(row, LIST_FIELDS.credit));
            for (const raw of ccList) {
              const base = brandCanonicalize(getBase(raw));
              const baseNorm = toNorm(base);
              if (baseNorm) creditMap.set(baseNorm, creditMap.get(baseNorm) || base);
            }
            // permanent cc name
            const ccName = firstField(row, LIST_FIELDS.permanentCCName);
            if (ccName) {
              const base = brandCanonicalize(getBase(ccName));
              const baseNorm = toNorm(base);
              if (baseNorm) creditMap.set(baseNorm, creditMap.get(baseNorm) || base);
            }
            // debit lists
            const dcList = splitList(firstField(row, LIST_FIELDS.debit));
            for (const raw of dcList) {
              const base = brandCanonicalize(getBase(raw));
              const baseNorm = toNorm(base);
              if (baseNorm) debitMap.set(baseNorm, debitMap.get(baseNorm) || base);
            }
          }

          f.setter(rows);
        }

        // build entries
        const credit = Array.from(creditMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "credit"));
        const debit = Array.from(debitMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "debit"));

        setCreditEntries(credit);
        setDebitEntries(debit);

        // keep list ready, but dropdown will only render when query has text
        setFilteredCards([
          ...(credit.length ? [{ type: "heading", label: "Credit Cards" }] : []),
          ...credit,
          ...(debit.length ? [{ type: "heading", label: "Debit Cards" }] : []),
          ...debit,
        ]);
      } catch (e) {
        console.error("CSV load error:", e);
      }
    }
    load();
  }, []);

  /** search box */
  const onChangeQuery = (e) => {
    const val = e.target.value;
    setQuery(val);
    setNoMatches(false);

    // ---- CHANGE #1: when input is empty -> hide dropdown AND clear previous offers ----
    if (!val.trim()) {
      setFilteredCards([]);   // no dropdown
      setSelected(null);      // clear previously selected card -> no offers shown
      return;
    }
    // -----------------------------------------------------------------------------------

    const scored = (arr) =>
      arr
        .map((it) => ({ it, s: scoreCandidate(val, it.display) }))
        .filter(({ s }) => s > 0.3)
        .sort((a, b) => (b.s - a.s) || a.it.display.localeCompare(b.it.display))
        .slice(0, MAX_SUGGESTIONS)
        .map(({ it }) => it);

    const cc = scored(creditEntries);
    const dc = scored(debitEntries);

    const out = [];
    if (cc.length) {
      out.push({ type: "heading", label: "Credit Cards" }, ...cc);
    }
    if (dc.length) {
      out.push({ type: "heading", label: "Debit Cards" }, ...dc);
    }
    setFilteredCards(out);
    if (!cc.length && !dc.length) setNoMatches(true);
  };

  const onPick = (entry) => {
    setSelected(entry);
    setQuery(entry.display);
    setFilteredCards([]);
  };

  /** Build matches for one CSV: return wrappers {offer, site, variantText} */
  function matchesFor(offers, type, site) {
    if (!selected) return [];
    const out = [];
    for (const o of offers || []) {
      let list = [];
      if (type === "permanent") {
        const nm = firstField(o, LIST_FIELDS.permanentCCName);
        if (nm) list = [nm];
      } else if (type === "debit") {
        list = splitList(firstField(o, LIST_FIELDS.debit));
      } else {
        list = splitList(firstField(o, LIST_FIELDS.credit));
      }
      let matched = false;
      let matchedVariant = "";
      for (const raw of list) {
        const base = brandCanonicalize(getBase(raw));
        if (toNorm(base) === selected.baseNorm) {
          matched = true;
          const v = getVariant(raw);
          if (v) matchedVariant = v; // only parentheses variant
          break;
        }
      }
      if (matched) {
        out.push({ offer: o, site, variantText: matchedVariant });
      }
    }
    return out;
  }

  // Collect then global-dedup by priority
  const wPermanent = matchesFor(permanentOffers, "permanent", "Permanent");
  const wAirline = matchesFor(airlineOffers, selected?.type === "debit" ? "debit" : "credit", "Airline");
  const wGoibibo = matchesFor(goibiboOffers, selected?.type === "debit" ? "debit" : "credit", "Goibibo");
  const wEase = matchesFor(easeOffers, selected?.type === "debit" ? "debit" : "credit", "EaseMyTrip");
  const wYDom = matchesFor(yatraDomesticOffers, selected?.type === "debit" ? "debit" : "credit", "Yatra (Domestic)");
  const wYInt = matchesFor(yatraInternationalOffers, selected?.type === "debit" ? "debit" : "credit", "Yatra (International)");
  const wIxigo = matchesFor(ixigoOffers, selected?.type === "debit" ? "debit" : "credit", "Ixigo");
  const wMMT = matchesFor(makeMyTripOffers, selected?.type === "debit" ? "debit" : "credit", "MakeMyTrip");
  const wCT = matchesFor(clearTripOffers, selected?.type === "debit" ? "debit" : "credit", "ClearTrip");

  const seen = new Set();
  const dPermanent = selected?.type === "credit" ? dedupWrappers(wPermanent, seen) : []; // permanent for credit only
  const dAirline = dedupWrappers(wAirline, seen);
  const dGoibibo = dedupWrappers(wGoibibo, seen);
  const dEase = dedupWrappers(wEase, seen);
  const dYDom = dedupWrappers(wYDom, seen);
  const dYInt = dedupWrappers(wYInt, seen);
  const dIxigo = dedupWrappers(wIxigo, seen);
  const dMMT = dedupWrappers(wMMT, seen);
  const dCT = dedupWrappers(wCT, seen);

  const hasAny =
    dPermanent.length ||
    dAirline.length ||
    dGoibibo.length ||
    dEase.length ||
    dYDom.length ||
    dYInt.length ||
    dIxigo.length ||
    dMMT.length ||
    dCT.length;

  /** Offer card UI */
  const OfferCard = ({ wrapper, isPermanent }) => {
    const o = wrapper.offer;
    const title = firstField(o, LIST_FIELDS.title) || o.Website || "Offer";
    const image = firstField(o, LIST_FIELDS.image);
    const desc = firstField(o, LIST_FIELDS.desc);
    const link = firstField(o, LIST_FIELDS.link);

    const showVariantNote =
      VARIANT_NOTE_SITES.has(wrapper.site) && wrapper.variantText && wrapper.variantText.trim().length > 0;

    const permanentBenefit = isPermanent ? firstField(o, LIST_FIELDS.permanentBenefit) : "";

    return (
      <div className="offer-card">
        {image && <img src={image} alt={title} />}
        <div className="offer-info">
          <h3 className="offer-title">{title}</h3>

          {/* Description body (hotel-style layout/serif) */}
          {isPermanent ? (
            <>
              {permanentBenefit && <p className="offer-desc">{permanentBenefit}</p>}
              <p className="inbuilt-note"><strong>This is a inbuilt feature of this credit card</strong></p>
            </>
          ) : (
            desc && <p className="offer-desc">{desc}</p>
          )}

          {/* Per-card variant note (red) above the CTA */}
          {showVariantNote && (
            <p className="network-note">
              <strong>Note:</strong> This benefit is applicable only on <em>{wrapper.variantText}</em> variant
            </p>
          )}

          {link && (
            <button className="btn" onClick={() => window.open(link, "_blank")}>
              View Offer
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="App" style={{ fontFamily: "'Libre Baskerville', serif" }}>
      {/* Search / dropdown */}
      <div className="dropdown" style={{ position: "relative", width: "600px", margin: "20px auto" }}>
        <input
          type="text"
          value={query}
          onChange={onChangeQuery}
          placeholder="Type a Credit or Debit Card...."
          className="dropdown-input"
          style={{
            width: "100%",
            padding: "12px",
            fontSize: "16px",
            border: `1px solid ${noMatches ? "#d32f2f" : "#ccc"}`,
            borderRadius: "6px",
          }}
        />
        {/* ---- CHANGE #2: show dropdown only when there is input AND results ---- */}
        {query.trim() && !!filteredCards.length && (
          <ul
            className="dropdown-list"
            style={{
              listStyle: "none",
              padding: "10px",
              margin: 0,
              width: "100%",
              maxHeight: "260px",
              overflowY: "auto",
              border: "1px solid #ccc",
              borderRadius: "6px",
              backgroundColor: "#fff",
              position: "absolute",
              zIndex: 1000,
            }}
          >
            {filteredCards.map((item, idx) =>
              item.type === "heading" ? (
                <li key={`h-${idx}`} style={{ padding: "8px 10px", fontWeight: 700, background: "#fafafa" }}>
                  {item.label}
                </li>
              ) : (
                <li
                  key={`i-${idx}-${item.display}`}
                  onClick={() => onPick(item)}
                  style={{
                    padding: "10px",
                    cursor: "pointer",
                    borderBottom: "1px solid #f2f2f2",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#f7f9ff")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {item.display}
                </li>
              )
            )}
          </ul>
        )}
        {/* --------------------------------------------------------------------- */}
      </div>

      {noMatches && (
        <p style={{ color: "#d32f2f", textAlign: "center", marginTop: 8 }}>
          No matching cards found. Please try a different name.
        </p>
      )}

      {/* Offers by section */}
      {selected && hasAny && (
        <div className="offers-section" style={{ maxWidth: 1200, margin: "0 auto", padding: 20 }}>
          {!!dPermanent.length && (
            <div className="offer-group">
              {/* ---- CHANGE #3: center section titles ---- */}
              <h2 style={{ textAlign: "center" }}>Permanent Offers</h2>
              <div className="offer-grid">
                {dPermanent.map((w, i) => (
                  <OfferCard key={`perm-${i}`} wrapper={w} isPermanent />
                ))}
              </div>
            </div>
          )}

          {!!dAirline.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Airline Offers</h2>
              <div className="offer-grid">
                {dAirline.map((w, i) => (
                  <OfferCard key={`air-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dGoibibo.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on Goibibo</h2>
              <div className="offer-grid">
                {dGoibibo.map((w, i) => (
                  <OfferCard key={`go-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dEase.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on EaseMyTrip</h2>
              <div className="offer-grid">
                {dEase.map((w, i) => (
                  <OfferCard key={`emt-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dYDom.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on Yatra (Domestic)</h2>
              <div className="offer-grid">
                {dYDom.map((w, i) => (
                  <OfferCard key={`yd-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dYInt.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on Yatra (International)</h2>
              <div className="offer-grid">
                {dYInt.map((w, i) => (
                  <OfferCard key={`yi-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dIxigo.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on Ixigo</h2>
              <div className="offer-grid">
                {dIxigo.map((w, i) => (
                  <OfferCard key={`ix-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dMMT.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on MakeMyTrip</h2>
              <div className="offer-grid">
                {dMMT.map((w, i) => (
                  <OfferCard key={`mmt-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dCT.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers on ClearTrip</h2>
              <div className="offer-grid">
                {dCT.map((w, i) => (
                  <OfferCard key={`ct-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* “No offers” message */}
      {selected && !hasAny && (
        <p style={{ color: "#d32f2f", textAlign: "center", marginTop: 10 }}>
          No offers found for {selected.display}
        </p>
      )}

      {/* Scroll button */}
      {selected && hasAny && (
        <button
          onClick={() => window.scrollBy({ top: window.innerHeight, behavior: "smooth" })}
          style={{
            position: "fixed",
            right: 20,
            bottom: isMobile ? 20 : 150,
            padding: isMobile ? "12px 15px" : "10px 20px",
            backgroundColor: "#1e7145",
            color: "white",
            border: "none",
            borderRadius: isMobile ? "50%" : 8,
            cursor: "pointer",
            fontSize: 18,
            zIndex: 1000,
            boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
            width: isMobile ? 50 : 140,
            height: isMobile ? 50 : 50,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {isMobile ? "↓" : "Scroll Down"}
        </button>
      )}

      {/* Centered disclaimer (screenshot style) */}
      <Disclaimer />
    </div>
  );
};

export default AirlineOffers;
