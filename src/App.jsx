import { useState, useEffect } from "react";
import axios from "axios";
import Papa from "papaparse";
import "./App.css";

const AirlineOffers = () => {
  const [creditCards, setCreditCards] = useState([]);
  const [debitCards, setDebitCards] = useState([]);
  const [filteredCards, setFilteredCards] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedCard, setSelectedCard] = useState("");
  const [easeOffers, setEaseOffers] = useState([]);
  const [yatraOffers, setYatraOffers] = useState([]);
  const [ixigoOffers, setIxigoOffers] = useState([]);
  const [airlineOffers, setAirlineOffers] = useState([]);
  const [noOffersMessage, setNoOffersMessage] = useState(false);

  useEffect(() => {
    const fetchCSVData = async () => {
      try {
        const files = [
          { name: "EASE MY TRIP AIRLINE.csv", setter: setEaseOffers },
          { name: "YATRA AIRLINE.csv", setter: setYatraOffers },
          { name: "IXIGO AIRLINE.csv", setter: setIxigoOffers },
          { name: "Airline-offers.csv", setter: setAirlineOffers },
        ];

        let allCreditCards = new Set();
        let allDebitCards = new Set();

        for (let file of files) {
          const response = await axios.get(`/${file.name}`);
          const parsedData = Papa.parse(response.data, { header: true });

          if (file.name === "Airline-offers.csv") {
            parsedData.data.forEach((row) => {
              if (row["Applicable Debit Cards"]) {
                row["Applicable Debit Cards"].split(",").forEach((card) => {
                  allDebitCards.add(card.trim());
                });
              }
            });
          } else {
            parsedData.data.forEach((row) => {
              if (row["Credit Card"]) {
                allCreditCards.add(row["Credit Card"].trim());
              }
            });
          }

          file.setter(parsedData.data);
        }

        setCreditCards(Array.from(allCreditCards).sort());
        setDebitCards(Array.from(allDebitCards).sort());
      } catch (error) {
        console.error("Error loading CSV data:", error);
      }
    };

    fetchCSVData();
  }, []);

  const handleInputChange = (event) => {
    const value = event.target.value;
    setQuery(value);

    if (value) {
      // Split search terms and match all terms (substring matching)
      const searchTerms = value.toLowerCase().split(/\s+/);
      
      const filteredCredit = creditCards.filter((card) => {
        const cardLower = card.toLowerCase();
        return searchTerms.every(term => cardLower.includes(term));
      });
      
      const filteredDebit = debitCards.filter((card) => {
        const cardLower = card.toLowerCase();
        return searchTerms.every(term => cardLower.includes(term));
      });

      // Combine filtered credit and debit cards with headings
      const combinedResults = [];
      if (filteredCredit.length > 0) {
        combinedResults.push({ type: "heading", label: "Credit Cards" });
        combinedResults.push(...filteredCredit.map((card) => ({ type: "credit", card })));
      }
      if (filteredDebit.length > 0) {
        combinedResults.push({ type: "heading", label: "Debit Cards" });
        combinedResults.push(...filteredDebit.map((card) => ({ type: "debit", card })));
      }

      setFilteredCards(combinedResults);

      if (filteredCredit.length === 0 && filteredDebit.length === 0) {
        setNoOffersMessage(true);
      } else {
        setNoOffersMessage(false);
      }
    } else {
      setFilteredCards([]);
      setNoOffersMessage(false);
      setSelectedCard("");
    }
  };

  const handleCardSelection = (card) => {
    setSelectedCard(card);
    setQuery(card);
    setFilteredCards([]);
    setNoOffersMessage(false);
  };

  const getOffersForSelectedCard = (offers, isDebit = false) => {
    return offers.filter((offer) => {
      if (isDebit) {
        return (
          offer["Applicable Debit Cards"] &&
          offer["Applicable Debit Cards"].split(",").map((c) => c.trim()).includes(selectedCard)
        );
      } else {
        return offer["Credit Card"] && offer["Credit Card"].trim() === selectedCard;
      }
    });
  };

  const selectedEaseOffers = getOffersForSelectedCard(easeOffers);
  const selectedYatraOffers = getOffersForSelectedCard(yatraOffers);
  const selectedIxigoOffers = getOffersForSelectedCard(ixigoOffers);
  const selectedDebitAirlineOffers = getOffersForSelectedCard(airlineOffers, true);

  return (
    <div className="App" style={{ fontFamily: "'Libre Baskerville', serif" }}>
      <nav style={styles.navbar}>
        <div style={styles.logoContainer}>
          <a href="https://www.myrupaya.in/">
            <img
              src="https://static.wixstatic.com/media/f836e8_26da4bf726c3475eabd6578d7546c3b2~mv2.jpg/v1/crop/x_124,y_0,w_3152,h_1458/fill/w_909,h_420,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/dark_logo_white_background.jpg"
              alt="MyRupaya Logo"
              style={styles.logo}
            />
          </a>
          <div style={styles.linksContainer}>
            <a href="https://www.myrupaya.in/" style={styles.link}>Home</a>
          </div>
        </div>
      </nav>

      <h1>Airline Offers</h1>

      <div
        className="dropdown"
        style={{ position: "relative", width: "600px", margin: "0 auto" }}
      >
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          placeholder="Type a Credit/Debit Card..."
          style={{
            width: "100%",
            padding: "12px",
            fontSize: "16px",
            border: "1px solid #ccc",
            borderRadius: "5px",
          }}
        />

        {filteredCards.length > 0 && (
          <ul
            style={{
              listStyleType: "none",
              padding: "10px",
              margin: 0,
              width: "100%",
              maxHeight: "200px",
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
                <li key={index} style={{ padding: "10px", fontWeight: "bold" }}>
                  {item.label}
                </li>
              ) : (
                <li
                  key={index}
                  onClick={() => handleCardSelection(item.card)}
                  style={{
                    padding: "10px",
                    cursor: "pointer",
                    borderBottom:
                      index !== filteredCards.length - 1
                        ? "1px solid #eee"
                        : "none",
                  }}
                  onMouseOver={(e) =>
                    (e.target.style.backgroundColor = "#f0f0f0")
                  }
                  onMouseOut={(e) =>
                    (e.target.style.backgroundColor = "transparent")
                  }
                >
                  {item.card}
                </li>
              )
            )}
          </ul>
        )}
      </div>

      {noOffersMessage && (
        <p style={{ color: "red", textAlign: "center", marginTop: "10px" }}>
          No matching offers found for the entered card.
        </p>
      )}

      {selectedCard && (
        <div className="offers-section">
          {selectedEaseOffers.length > 0 && (
            <div>
              <h2>Offers on EaseMyTrip</h2>
              <div className="offer-grid">
                {selectedEaseOffers.map((offer, index) => (
                  <div key={index} className="offer-card">
                    <img src={offer.Image} alt={offer.Title} />
                    <div className="offer-info">
                      <h3>{offer.Title}</h3>
                      <p>{offer.Offer}</p>
                      <button onClick={() => window.open(offer.Link, "_blank")}>
                        View Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedYatraOffers.length > 0 && (
            <div>
              <h2>Offers on Yatra</h2>
              <div className="offer-grid">
                {selectedYatraOffers.map((offer, index) => (
                  <div key={index} className="offer-card">
                    <img src={offer.Image} alt={offer.Title} />
                    <div className="offer-info">
                      <h3>{offer.Title}</h3>
                      <p>{offer.Offer}</p>
                      <button onClick={() => window.open(offer.Link, "_blank")}>
                        View Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedIxigoOffers.length > 0 && (
            <div>
              <h2>Offers on Ixigo</h2>
              <div className="offer-grid">
                {selectedIxigoOffers.map((offer, index) => (
                  <div key={index} className="offer-card">
                    <img src={offer.Image} alt={offer.Title} />
                    <div className="offer-info">
                      <h3>{offer.Title}</h3>
                      <p>{offer.Offer}</p>
                      <button onClick={() => window.open(offer.Link, "_blank")}>
                        View Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedDebitAirlineOffers.length > 0 && (
            <div>
              <h2>Airline Debit Card Offers</h2>
              <div className="offer-grid">
                {selectedDebitAirlineOffers.map((offer, index) => (
                  <div key={index} className="offer-card">
                    <img src={offer.Image} alt={offer.Website} />
                    <div className="offer-info">
                      <h3>{offer.Website}</h3>
                      <p>{offer.Offer}</p>
                      <button onClick={() => window.open(offer.Link, "_blank")}>
                        View Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const styles = {
  navbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 20px",
    backgroundColor: "#CDD1C1",
  },
  logoContainer: {
    display: "flex",
    alignItems: "center",
  },
  logo: {
    width: "100px",
    height: "100px",
    marginRight: "20px",
  },
  linksContainer: {
    display: "flex",
    gap: "35px",
    flexWrap: "wrap",
    marginLeft: "40px",
  },
  link: {
    textDecoration: "none",
    color: "black",
    fontSize: "18px",
    fontFamily: "Arial, sans-serif",
    transition: "color 0.3s ease",
  },
};

export default AirlineOffers;