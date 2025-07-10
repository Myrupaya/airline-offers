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
  const [yatraDomesticOffers, setYatraDomesticOffers] = useState([]);
  const [yatraInternationalOffers, setYatraInternationalOffers] = useState([]);
  const [ixigoOffers, setIxigoOffers] = useState([]);
  const [airlineOffers, setAirlineOffers] = useState([]);
  const [noOffersMessage, setNoOffersMessage] = useState(false);
  const [makeMyTripOffers, setMakeMyTripOffers] = useState([]);
  const [clearTripOffers, setClearTripOffers] = useState([]);
  const [goibiboOffers, setGoibiboOffers] = useState([]);
  const [permanentOffers, setPermanentOffers] = useState([]);
  const [isDebitCardSelected, setIsDebitCardSelected] = useState(false);

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

        let allCreditCards = new Set();
        let allDebitCards = new Set();

        for (let file of files) {
          const response = await axios.get(`/${file.name}`);
          const parsedData = Papa.parse(response.data, { header: true });

          if (file.name === "Airline-offers.csv") {
            // extract debit cards
            parsedData.data.forEach((row) => {
              if (row["Applicable Debit Cards"]) {
                row["Applicable Debit Cards"].split(",").forEach((card) => {
                  allDebitCards.add(card.trim());
                });
              }
            });
          } else if (file.name === "Updated_Permanent_Offers.csv") {
            // extract credit cards from permanent offers
            parsedData.data.forEach((row) => {
              if (row["Credit Card Name"]) {
                allCreditCards.add(row["Credit Card Name"].trim());
              }
            });
          } else {
            // extract credit cards from all other files
            parsedData.data.forEach((row) => {
              if (row["Eligible Cards"]) {
                row["Eligible Cards"].split(",").forEach((card) => {
                  allCreditCards.add(card.trim());
                });
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
        setSelectedCard("");
      } else {
        setNoOffersMessage(false);
      }
    } else {
      setFilteredCards([]);
      setNoOffersMessage(false);
      setSelectedCard("");
    }
  };

  const handleCardSelection = (card, type) => {
    setSelectedCard(card);
    setQuery(card);
    setFilteredCards([]);
    setNoOffersMessage(false);
    setIsDebitCardSelected(type === "debit");
  };

  const getOffersForSelectedCard = (offers, isDebit = false, isPermanent = false) => {
    return offers.filter((offer) => {
      if (isDebit) {
        return (
          offer["Applicable Debit Cards"] &&
          offer["Applicable Debit Cards"].split(",").map((c) => c.trim()).includes(selectedCard)
        );
      } else if (isPermanent) {
        return (
          offer["Credit Card Name"] &&
          offer["Credit Card Name"].trim() === selectedCard
        );
      } else {
        return (
          offer["Eligible Cards"] &&
          offer["Eligible Cards"].split(",").map((c) => c.trim()).includes(selectedCard)
        );
      }
    });
  };

  const selectedEaseOffers = getOffersForSelectedCard(easeOffers);
  const selectedYatraDomesticOffers = getOffersForSelectedCard(yatraDomesticOffers);
  const selectedYatraInternationalOffers = getOffersForSelectedCard(yatraInternationalOffers);
  const selectedIxigoOffers = getOffersForSelectedCard(ixigoOffers);
  const selectedDebitAirlineOffers = getOffersForSelectedCard(airlineOffers, true);
  const selectedMakeMyTripOffers = getOffersForSelectedCard(makeMyTripOffers);
  const selectedClearTripOffers = getOffersForSelectedCard(clearTripOffers);
  const selectedGoibiboOffers = getOffersForSelectedCard(goibiboOffers);
  const selectedPermanentOffers = getOffersForSelectedCard(permanentOffers, false, true);

  // Calculate if we should show scroll button
  const hasAnyOffers = 
    selectedEaseOffers.length > 0 ||
    selectedYatraDomesticOffers.length > 0 ||
    selectedYatraInternationalOffers.length > 0 ||
    selectedIxigoOffers.length > 0 ||
    selectedDebitAirlineOffers.length > 0 ||
    selectedMakeMyTripOffers.length > 0 ||
    selectedClearTripOffers.length > 0 ||
    selectedGoibiboOffers.length > 0 ||
    selectedPermanentOffers.length > 0;
  
  const showScrollButton = hasAnyOffers;

  // Scroll down handler
  const handleScrollDown = () => {
    window.scrollBy({
      top: window.innerHeight,
      behavior: "smooth"
    });
  };

  return (
    <div className="App" style={{ fontFamily: "'Libre Baskerville', serif" }}>
      <div
        className="dropdown"
        style={{ position: "relative", width: "600px", margin: "5px auto" }}
      >
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          placeholder="Type a Credit Card..."
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
                  onClick={() => handleCardSelection(item.card, item.type)}
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
        <div className="offers-section" style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
          {/* Debit Card Offers Section - Show first if debit card selected */}
          {isDebitCardSelected && selectedDebitAirlineOffers.length > 0 && (
            <div>
              <h2>Debit Card Offers</h2>
              <div className="offer-grid">
                {selectedDebitAirlineOffers.map((offer, index) => (
                  <div key={index} className="offer-card">
                    {offer.Image && <img src={offer.Image} alt={offer.Website} />}
                    <div className="offer-info">
                      <h3>{offer["Offer Title"] || offer.Website}</h3>
                      {offer.Validity && <p>Validity: {offer.Validity}</p>}
                      {offer.Link && (
                        <button onClick={() => window.open(offer.Link, "_blank")}>
                          View Details
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Permanent Offers Section */}
          {!isDebitCardSelected && selectedPermanentOffers.length > 0 && (
            <div>
              <h2>Permanent Offers</h2>
              <div className="offer-grid">
                {selectedPermanentOffers.map((offer, index) => (
                  <div key={index} className="offer-card">
                    <img src={offer["Credit Card Image"]} alt={offer["Credit Card Name"]} />
                    <div className="offer-info">
                      <h3>{offer["Flight Benefit"]}</h3>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Goibibo Offers Section */}
          {!isDebitCardSelected && selectedGoibiboOffers.length > 0 && (
            <div>
              <h2>Offers on Goibibo</h2>
              <div className="offer-grid">
                {selectedGoibiboOffers.map((offer, index) => (
                  <div key={index} className="offer-card">
                    {offer.Image && <img src={offer.Image} alt={offer.Title} />}
                    <div className="offer-info">
                      <h3>{offer["Offer Title"]}</h3>
                      {offer.Link && (
                        <button onClick={() => window.open(offer.Link, "_blank")}>
                          View Details
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* EaseMyTrip Offers Section */}
          {!isDebitCardSelected && selectedEaseOffers.length > 0 && (
            <div>
              <h2>Offers on EaseMyTrip</h2>
              <div className="offer-grid">
                {selectedEaseOffers.map((offer, index) => (
                  <div key={index} className="offer-card">
                    {offer.Image && <img src={offer.Image} alt={offer.Title} />}
                    <div className="offer-info">
                      <h3>{offer["Offer Title"]}</h3>
                      {offer.Link && (
                        <button onClick={() => window.open(offer.Link, "_blank")}>
                          View Details
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Yatra Domestic Offers Section */}
          {!isDebitCardSelected && selectedYatraDomesticOffers.length > 0 && (
            <div>
              <h2>Offers on Yatra (Domestic)</h2>
              <div className="offer-grid">
                {selectedYatraDomesticOffers.map((offer, index) => (
                  <div key={index} className="offer-card">
                    {offer.Image && <img src={offer.Image} alt={offer.Title} />}
                    <div className="offer-info">
                      <h3>{offer["Offer Title"]}</h3>
                      {offer.Link && (
                        <button onClick={() => window.open(offer.Link, "_blank")}>
                          View Details
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Yatra International Offers Section */}
          {!isDebitCardSelected && selectedYatraInternationalOffers.length > 0 && (
            <div>
              <h2>Offers on Yatra (International)</h2>
              <div className="offer-grid">
                {selectedYatraInternationalOffers.map((offer, index) => (
                  <div key={index} className="offer-card">
                    {offer.Image && <img src={offer.Image} alt={offer.Title} />}
                    <div className="offer-info">
                      <h3>{offer["Offer Title"]}</h3>
                      {offer.Link && (
                        <button onClick={() => window.open(offer.Link, "_blank")}>
                          View Details
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ixigo Offers Section */}
          {!isDebitCardSelected && selectedIxigoOffers.length > 0 && (
            <div>
              <h2>Offers on Ixigo</h2>
              <div className="offer-grid">
                {selectedIxigoOffers.map((offer, index) => (
                  <div key={index} className="offer-card">
                    {offer.Image && <img src={offer.Image} alt={offer.Title} />}
                    <div className="offer-info">
                      <h3>{offer["Offer Title"]}</h3>
                      {offer.Link && (
                        <button onClick={() => window.open(offer.Link, "_blank")}>
                          View Details
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MakeMyTrip Offers Section */}
          {!isDebitCardSelected && selectedMakeMyTripOffers.length > 0 && (
            <div>
              <h2>Offers on MakeMyTrip</h2>
              <div className="offer-grid">
                {selectedMakeMyTripOffers.map((offer, index) => (
                  <div key={index} className="offer-card">
                    {offer.Image && <img src={offer.Image} alt={offer.Title} />}
                    <div className="offer-info">
                      <h3>{offer["Offer Title"]}</h3>
                      {offer.Link && (
                        <button onClick={() => window.open(offer.Link, "_blank")}>
                          View Details
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ClearTrip Offers Section */}
          {!isDebitCardSelected && selectedClearTripOffers.length > 0 && (
            <div>
              <h2>Offers on ClearTrip</h2>
              <div className="offer-grid">
                {selectedClearTripOffers.map((offer, index) => (
                  <div key={index} className="offer-card">
                    {offer.Image && <img src={offer.Image} alt={offer.Title} />}
                    <div className="offer-info">
                      <h3>{offer["Offer Title"]}</h3>
                      {offer.Link && (
                        <button onClick={() => window.open(offer.Link, "_blank")}>
                          View Details
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scroll Down Button */}
      {showScrollButton && (
        <button 
          onClick={handleScrollDown}
          style={{
            position: 'fixed',
            right: '20px',
            bottom: '150px',
            padding: '10px 15px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '16px',
            zIndex: 1000,
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
          }}
        >
          Scroll Down
        </button>
      )}
    </div>
  );
};

export default AirlineOffers;