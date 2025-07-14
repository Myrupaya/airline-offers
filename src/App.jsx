import React, { useState, useEffect } from "react";
import axios from "axios";
import Papa from "papaparse";
import "./App.css";

const CreditCardDropdown = () => {
  const [creditCards, setCreditCards] = useState([]);
  const [debitCards, setDebitCards] = useState([]);
  const [filteredCards, setFilteredCards] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedCard, setSelectedCard] = useState("");
  const [pvrOffers, setPvrOffers] = useState([]);
  const [inoxOffers, setInoxOffers] = useState([]);
  const [bookMyShowOffers, setBookMyShowOffers] = useState([]);
  const [movieDebitOffers, setMovieDebitOffers] = useState([]);
  const [movieBenefits, setMovieBenefits] = useState([]);
  const [expandedOfferIndex, setExpandedOfferIndex] = useState({ 
    pvr: null, 
    inox: null, 
    bms: null 
  });
  const [showNoCardMessage, setShowNoCardMessage] = useState(false);
  const [typingTimeout, setTypingTimeout] = useState(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 100;
      setShowScrollButton(!nearBottom);
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll(); // Check initial position
    
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleScrollDown = () => {
    window.scrollBy({
      top: window.innerHeight * 0.8,
      behavior: 'smooth'
    });
  };

  const toggleOfferDetails = (type, index) => {
    setExpandedOfferIndex(prev => ({
      ...prev,
      [type]: prev[type] === index ? null : index
    }));
  };

  useEffect(() => {
    const fetchCSVData = async () => {
      try {
        const [pvrResponse, inoxResponse, bmsResponse, debitResponse, benefitsResponse] = await Promise.all([
          axios.get("/Pvr final.csv"),
          axios.get("/Inox final.csv"),
          axios.get("/Book My Show final.csv"),
          axios.get("/Final_Cleaned_Movie_Offers.csv"),
          axios.get("/Final_Movie_Benefits_List_With_Images.csv")
        ]);

        const pvrData = Papa.parse(pvrResponse.data, { header: true });
        const inoxData = Papa.parse(inoxResponse.data, { header: true });
        const bmsData = Papa.parse(bmsResponse.data, { header: true });
        const debitData = Papa.parse(debitResponse.data, { header: true });
        const benefitsData = Papa.parse(benefitsResponse.data, { header: true });

        setPvrOffers(pvrData.data);
        setInoxOffers(inoxData.data);
        setBookMyShowOffers(bmsData.data);
        setMovieDebitOffers(debitData.data);
        setMovieBenefits(benefitsData.data);

        const benefitsCreditCards = new Set();
        benefitsData.data.forEach(row => {
          if (row["Credit Card Name"]) {
            benefitsCreditCards.add(row["Credit Card Name"].trim());
          }
        });

        const otherCreditCards = new Set();
        
        pvrData.data.forEach(row => {
          if (row["Credit Card"]) {
            otherCreditCards.add(row["Credit Card"].trim());
          }
        });
        
        inoxData.data.forEach(row => {
          if (row["Credit Card"]) {
            otherCreditCards.add(row["Credit Card"].trim());
          }
        });
        
        bmsData.data.forEach(row => {
          if (row["Credit Card"]) {
            otherCreditCards.add(row["Credit Card"].trim());
          }
        });

        const allCreditCards = new Set([...benefitsCreditCards, ...otherCreditCards]);

        const allDebitCards = new Set();
        debitData.data.forEach(row => {
          if (row["Applicable Debit Cards"]) {
            row["Applicable Debit Cards"].split(",").forEach(card => {
              allDebitCards.add(card.trim());
            });
          }
        });

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
    setShowNoCardMessage(false);

    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }

    if (!value) {
      setSelectedCard("");
      setFilteredCards([]);
      return;
    }

    const queryWords = value.toLowerCase().split(/\s+/).filter(word => word.length > 0);
    
    const filteredCredit = creditCards.filter((card) => {
      const cardLower = card.toLowerCase();
      return queryWords.every(word => cardLower.includes(word));
    });
    
    const filteredDebit = debitCards.filter((card) => {
      const cardLower = card.toLowerCase();
      return queryWords.every(word => cardLower.includes(word));
    });

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

    if (combinedResults.length === 0 && value.length > 2) {
      const timeout = setTimeout(() => {
        setShowNoCardMessage(true);
      }, 1000);
      setTypingTimeout(timeout);
    }
  };

  const handleCardSelection = (card) => {
    setSelectedCard(card);
    setQuery(card);
    setFilteredCards([]);
    setExpandedOfferIndex({ pvr: null, inox: null, bms: null });
    setShowNoCardMessage(false);
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
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

  const getMovieBenefitsForSelectedCard = () => {
    return movieBenefits.filter(offer => {
      const cardName = offer["Credit Card Name"] ? offer["Credit Card Name"].trim() : "";
      return cardName.toLowerCase() === selectedCard.toLowerCase();
    });
  };

  const selectedPvrOffers = getOffersForSelectedCard(pvrOffers);
  const selectedInoxOffers = getOffersForSelectedCard(inoxOffers);
  const selectedBookMyShowOffers = getOffersForSelectedCard(bookMyShowOffers);
  const selectedMovieDebitOffers = getOffersForSelectedCard(movieDebitOffers, true);
  const selectedMovieBenefits = getMovieBenefitsForSelectedCard();

  const hasAnyOffers = () => {
    return (
      selectedPvrOffers.length > 0 ||
      selectedInoxOffers.length > 0 ||
      selectedBookMyShowOffers.length > 0 ||
      selectedMovieDebitOffers.length > 0 ||
      selectedMovieBenefits.length > 0
    );
  };

  return (
    <div className="App">
      <div className="content-container">
        <div className="creditCardDropdown" style={{ position: "relative", width: "600px", margin: "2px auto", marginTop:"2px" }}>
          <input
            type="text"
            value={query}
            onChange={handleInputChange}
            placeholder="Type a Credit Card..."
            style={{
              width: "90%",
              padding: "12px",
              fontSize: "16px",
              border: `1px solid ${showNoCardMessage ? 'red' : '#ccc'}`,
              borderRadius: "5px",
            }}
          />
          {filteredCards.length > 0 && (
            <ul
              style={{
                listStyleType: "none",
                padding: "10px",
                margin: 0,
                width: "90%",
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
                  <li key={index} className="dropdown-heading">
                    <strong>{item.label}</strong>
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

        {showNoCardMessage && (
          <div style={{
            textAlign: "center",
            margin: "40px 0",
            fontSize: "20px",
            color: "red",
            fontWeight: "bold"
          }}>
            No offers for this card
          </div>
        )}

        {selectedCard && !hasAnyOffers() && !showNoCardMessage && (
          <div style={{
            textAlign: "center",
            margin: "40px 0",
            fontSize: "20px",
            color: "#666"
          }}>
            No offers found for {selectedCard}
          </div>
        )}

        {selectedCard && hasAnyOffers() && (
          <div className="offer-section">
            {selectedMovieBenefits.length > 0 && (
              <div className="offer-container">
                <h2 style={{ textAlign: "center", margin: "20px 0" }}>Permanent Offers on {selectedCard}</h2>
                <div className="offer-row">
                  {selectedMovieBenefits.map((benefit, index) => (
                    <div key={`benefit-${index}`} className="offer-card" style={{backgroundColor: "#f5f5f5", color: "black"}}>
                      {benefit.image && (
                        <img 
                          src={benefit.image} 
                          alt={benefit["Credit Card Name"] || "Card Offer"} 
                          style={{ 
                            maxWidth: "100%", 
                            height: "auto",
                            maxHeight: "150px",
                            objectFit: "contain",
                          }}
                        />
                      )}
                      <h3>{benefit["Credit Card Name"] || "Card Offer"}</h3>
                      {benefit["Movie Benefit"] && <p><strong>Benefit:</strong> {benefit["Movie Benefit"]}</p>}
                      {benefit.Terms && <p><strong>Terms:</strong> {benefit.Terms}</p>}
                      {benefit.Link && (
                        <button 
                          onClick={() => window.open(benefit.Link, "_blank")}
                          className="view-details-btn"
                        >
                          View Details
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedPvrOffers.length > 0 && (
              <div className="offer-container">
                <h2>PVR Offers</h2>
                <div className="offer-row">
                  {selectedPvrOffers.map((offer, index) => (
                    <div 
                      key={`pvr-${index}`} 
                      className={`offer-card ${expandedOfferIndex.pvr === index ? 'expanded' : ''}`}
                      style={{
                        backgroundColor: "#f5f5f5", 
                        color: "black",
                        height: expandedOfferIndex.pvr === index ? 'auto' : '400px',
                        overflow: 'hidden'
                      }}
                    >
                      {offer.Image && (
                        <img 
                          src={offer.Image} 
                          alt={offer.Title || "PVR Offer"} 
                          style={{ 
                            maxWidth: "100%", 
                            height: "auto",
                            maxHeight: "150px",
                            objectFit: "contain"
                          }} 
                        />
                      )}
                      <h3>{offer.Title || "PVR Offer"}</h3>
                      {offer.Validity && <p><strong>Validity:</strong> {offer.Validity}</p>}
                      
                      {expandedOfferIndex.pvr === index && (
                        <div className="terms-container" style={{ 
                          maxHeight: '200px',
                          overflowY: 'auto',
                          padding: '10px',
                          backgroundColor: 'rgba(0,0,0,0.1)',
                          borderRadius: '5px',
                          marginTop: '10px'
                        }}>
                          <h4>Offer Details:</h4>
                          <p>{offer.Offers}</p>
                        </div>
                      )}
                      
                      <button 
                        onClick={() => toggleOfferDetails("pvr", index)}
                        className={`details-btn ${expandedOfferIndex.pvr === index ? "active" : ""}`}
                        style={{ marginTop: '10px' }}
                      >
                        {expandedOfferIndex.pvr === index ? "Hide Details" : "Click For More Details"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedInoxOffers.length > 0 && (
              <div className="offer-container">
                <h2>INOX Offers</h2>
                <div className="offer-row">
                  {selectedInoxOffers.map((offer, index) => (
                    <div 
                      key={`inox-${index}`} 
                      className={`offer-card ${expandedOfferIndex.inox === index ? 'expanded' : ''}`}
                      style={{
                        backgroundColor: "#f5f5f5", 
                        color: "black",
                        height: expandedOfferIndex.inox === index ? 'auto' : '400px',
                        overflow: 'hidden'
                      }}
                    >
                      {offer.Image && (
                        <img 
                          src={offer.Image} 
                          alt={offer.Title || "INOX Offer"} 
                          style={{ 
                            maxWidth: "100%", 
                            height: "auto",
                            maxHeight: "150px",
                            objectFit: "contain"
                          }} 
                        />
                      )}
                      <h3>{offer.Title || "INOX Offer"}</h3>
                      {offer.Validity && <p><strong>Validity:</strong> {offer.Validity}</p>}
                      
                      {expandedOfferIndex.inox === index && (
                        <div className="terms-container" style={{ 
                          maxHeight: '200px',
                          overflowY: 'auto',
                          padding: '10px',
                          backgroundColor: 'rgba(0,0,0,0.1)',
                          borderRadius: '5px',
                          marginTop: '10px'
                        }}>
                          <h4>Offer Details:</h4>
                          <p>{offer.Offers}</p>
                        </div>
                      )}
                      
                      <button 
                        onClick={() => toggleOfferDetails("inox", index)}
                        className={`details-btn ${expandedOfferIndex.inox === index ? "active" : ""}`}
                        style={{ marginTop: '10px' }}
                      >
                        {expandedOfferIndex.inox === index ? "Hide Details" : "Click For More Details"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedBookMyShowOffers.length > 0 && (
              <div className="offer-container">
                <h2>BookMyShow Offers</h2>
                <div className="offer-row">
                  {selectedBookMyShowOffers.map((offer, index) => (
                    <div 
                      key={`bms-${index}`} 
                      className={`offer-card ${expandedOfferIndex.bms === index ? 'expanded' : ''}`}
                      style={{
                        backgroundColor: "#f5f5f5", 
                        color: "black",
                        height: "auto",
                        overflow: 'hidden'
                      }}
                    >
                      {offer.Image && (
                        <img 
                          src={offer.Image} 
                          alt={offer.Title || "BookMyShow Offer"} 
                          style={{ 
                            maxWidth: "100%", 
                            height: "auto",
                            maxHeight: "150px",
                            objectFit: "contain"
                          }} 
                        />
                      )}
                      <h3>{offer.Title || "BookMyShow Offer"}</h3>
                      {offer.Offer && <p><strong>Offer:</strong> {offer.Offer}</p>}
                      {offer.Validity && <p><strong>Validity:</strong> {offer.Validity}</p>}
                      
                      {expandedOfferIndex.bms === index && (
                        <div className="terms-container" style={{ 
                          maxHeight: '200px',
                          overflowY: 'auto',
                          padding: '10px',
                          backgroundColor: 'rgba(0,0,0,0.1)',
                          borderRadius: '5px',
                          marginTop: '10px'
                        }}>
                          <h4>Offer Details:</h4>
                          <p>{offer.Offers || "No additional details available"}</p>
                        </div>
                      )}
                      
                      {offer.Link ? (
                        <a 
                          href={offer.Link} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ textDecoration: "none" }}
                        >
                          <button 
                            className="view-details-btn"
                            style={{ marginTop: '10px', cursor: 'pointer' }}
                          >
                            View Details
                          </button>
                        </a>
                      ) : (
                        <button 
                          onClick={() => toggleOfferDetails("bms", index)}
                          className={`details-btn ${expandedOfferIndex.bms === index ? "active" : ""}`}
                          style={{ marginTop: '10px' }}
                        >
                          {expandedOfferIndex.bms === index ? "Hide Details" : "Click For More Details"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedMovieDebitOffers.length > 0 && (
              <div className="offer-container">
                <h2>Debit Card Offers</h2>
                <div className="offer-row">
                  {selectedMovieDebitOffers.map((offer, index) => (
                    <div 
                      key={`debit-${index}`} 
                      className="offer-card" 
                      style={{ backgroundColor: "#f5f5f5", color: "black" }}
                    >
                      {offer.Image && (
                        <img 
                          src={offer.Image} 
                          alt={offer.Website || "Debit Card Offer"} 
                          style={{ 
                            maxWidth: "100%", 
                            height: "auto",
                            maxHeight: "150px",
                            objectFit: "contain"
                          }}
                        />
                      )}
                      <h3>{offer.Website || "Debit Card Offer"}</h3>
                      {offer.Offer && <p>{offer.Offer}</p>}
                      {offer.Link && (
                        <a 
                          href={offer.Link} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="view-details-btn"
                          style={{
                            display: "inline-block",
                            padding: "10px 20px",
                            backgroundColor: "#1e7145",
                            color: "#fff",
                            borderRadius: "5px",
                            textDecoration: "none",
                            fontWeight: "bold",
                            marginTop: "10px"
                          }}
                        >
                          View Details
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scroll Down Button */}
      {showScrollButton && (
        <button 
          onClick={handleScrollDown}
          style={{
            position: 'fixed',
            right: '20px',
            bottom: '20px',
            padding: window.innerWidth > 768 ? '10px 15px' : '8px 12px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: window.innerWidth > 768 ? '5px' : '50%',
            cursor: 'pointer',
            fontSize: window.innerWidth > 768 ? '16px' : '24px',
            zIndex: 1000,
            boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
            width: window.innerWidth > 768 ? 'auto' : '50px',
            height: window.innerWidth > 768 ? 'auto' : '50px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.3s ease'
          }}
          aria-label="Scroll down"
        >
          {window.innerWidth > 768 ? 'Scroll Down' : '↓'}
        </button>
      )}
    </div>
  );
};

export default CreditCardDropdown;
