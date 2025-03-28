'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { getCurrentPosition } from '../lib/geoLocation';
import dynamic from 'next/dynamic';

// Use dynamic import for the TransitMap - moved outside the component
const TransitMap = dynamic(() => import('./TransitMap'), { 
  ssr: false,
  loading: () => (
    <div className="bg-gray-100 rounded-lg text-center h-[50vh] flex items-center justify-center">
      <p className="text-gray-600">Loading map component...</p>
    </div>
  )
});

// Load the train map component
const TrainMap = dynamic(() => import('./TrainMap'), {
  ssr: false,
  loading: () => (
    <div className="bg-gray-100 rounded-lg text-center p-4">
      <p className="text-gray-600">Loading train data...</p>
    </div>
  )
});

// Transit line to color mapping
const lineColors = {
  'A': '#2850AD', 'C': '#2850AD', 'E': '#2850AD', // Blue
  '1': '#EE352E', '2': '#EE352E', '3': '#EE352E', // Red
  '4': '#00933C', '5': '#00933C', '6': '#00933C', // Green
  'B': '#FF6319', 'D': '#FF6319', 'F': '#FF6319', 'M': '#FF6319', // Orange
  'N': '#FCCC0A', 'Q': '#FCCC0A', 'R': '#FCCC0A', 'W': '#FCCC0A', // Yellow
  'G': '#6CBE45', // Light Green
  'J': '#996633', 'Z': '#996633', // Brown
  'L': '#A7A9AC', // Gray
  '7': '#B933AD', // Purple
  'S': '#808183', // Silver
};

export default function StationView() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [location, setLocation] = useState(null);
  const stableLocationRef = useRef(null); // Stable location reference
  const [stationInfo, setStationInfo] = useState(null);
  const [stationId, setStationId] = useState(null);
  const [upcomingTrains, setUpcomingTrains] = useState([]);
  const [trainReports, setTrainReports] = useState({});
  const [nearbyStations, setNearbyStations] = useState([]);
  const [allStations, setAllStations] = useState([]);
  const [showStationPicker, setShowStationPicker] = useState(false);
  const mapInfoRef = useRef(null); // Use ref instead of state
  const [isDataLoading, setIsDataLoading] = useState(false);
  const loadStationDataRef = useRef(null); // Reference for loading function
  const dataTimeoutRef = useRef(null); // For debouncing data loading
  
  // Update stable location ref when location changes
  useEffect(() => {
    if (location) {
      stableLocationRef.current = location;
    }
  }, [location]);
  
  // Load initial location and nearby stations
  useEffect(() => {
    let isMounted = true;
    
    async function initialize() {
      try {
        if (!isMounted) return;
        
        setLoading(true);
        setError(null);
        
        // Get current location
        const position = await getCurrentPosition();
        if (!isMounted) return;
        
        setLocation(position);
        stableLocationRef.current = position;
        
        // Fetch nearby stations
        const stationsResponse = await fetch(`/api/stations/nearby?lat=${position.latitude}&lon=${position.longitude}`);
        
        if (!isMounted) return;
        
        if (!stationsResponse.ok) {
          throw new Error('Failed to fetch nearby stations');
        }
        
        const stationsData = await stationsResponse.json();
        if (!isMounted) return;
        
        setNearbyStations(stationsData.stations);
        
        if (stationsData.stations.length > 0) {
          // Use the closest station by default
          setStationId(stationsData.stations[0].id);
          setShowStationPicker(stationsData.stations.length > 1);
        }
        
        // Fetch all stations for the map
        await fetchAllStations(position.latitude, position.longitude);
        
      } catch (err) {
        console.error('Error initializing:', err);
        if (isMounted) {
          setError(err.message || 'Error finding nearby stations. Please try again.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }
    
    initialize();
    
    return () => {
      isMounted = false;
    };
  }, []);
  
  // Fetch all stations (for map rendering)
  const fetchAllStations = useCallback(async (lat, lon) => {
    try {
      const allStationsResponse = await fetch(`/api/stations?lat=${lat}&lon=${lon}`);
      
      if (!allStationsResponse.ok) {
        throw new Error('Failed to fetch all stations');
      }
      
      const allStationsData = await allStationsResponse.json();
      setAllStations(allStationsData.stations);
      
    } catch (err) {
      console.error('Error fetching all stations:', err);
      // Non-critical, so we don't set the error state
    }
  }, []);
  
  // Handle map movement and update visible stations
  const handleMapMove = useCallback((info) => {
    // Store in ref instead of state to avoid re-renders
    mapInfoRef.current = info;
  }, []);
  
  // Handle station selection
  const handleStationSelect = useCallback((id) => {
    setStationId(id);
  }, []);
  
  // Handle station dropdown change
  const handleStationChange = useCallback((event) => {
    setStationId(event.target.value);
  }, []);
  
  // Load station data when stationId changes
  useEffect(() => {
    if (!stationId) return;
    
    let isMounted = true;
    
    // Define the function to load station data
    const loadStationData = async () => {
      if (!isMounted) return;
      
      try {
        setIsDataLoading(true);
        
        // Find the station details first (for immediate UI update)
        const stationDetails = 
          nearbyStations.find(s => s.id === stationId) || 
          allStations.find(s => s.id === stationId) || 
          null;
          
        if (stationDetails && isMounted) {
          setStationInfo(prevInfo => ({
            ...(prevInfo || {}),
            id: stationId,
            name: stationDetails.name,
            lines: stationDetails.lines
          }));
        }
        
        // Fetch station info and arrivals
        const stationResponse = await fetch(`/api/station/${stationId}`);
        
        if (!isMounted) return;
        
        if (!stationResponse.ok) {
          throw new Error('Failed to fetch station information');
        }
        
        const stationData = await stationResponse.json();
        
        if (!isMounted) return;
        
        setUpcomingTrains(stationData.arrivals);
        
        // Merge station data with details
        if (stationDetails && isMounted) {
          setStationInfo({
            ...stationData.station,
            name: stationDetails.name,
            lines: stationDetails.lines
          });
        } else if (isMounted) {
          setStationInfo(stationData.station);
        }
        
        // Fetch reports for each train (limited to avoid too many requests)
        if (isMounted) {
          const reportsMap = {};
          const trainsToFetch = stationData.arrivals.slice(0, 5); // Limit to first 5 trains
          
          for (const train of trainsToFetch) {
            if (!isMounted) return;
            
            try {
              const reportResponse = await fetch(`/api/reports?trainId=${train.id}`);
              
              if (reportResponse.ok && isMounted) {
                const reportData = await reportResponse.json();
                reportsMap[train.id] = reportData;
              }
            } catch (reportErr) {
              console.error(`Error fetching reports for train ${train.id}:`, reportErr);
              // Continue with other trains even if one fails
            }
          }
          
          if (isMounted) {
            setTrainReports(reportsMap);
          }
        }
        
      } catch (err) {
        console.error('Error loading station data:', err);
        // We don't set the main error state here to avoid blocking the UI
      } finally {
        if (isMounted) {
          setIsDataLoading(false);
        }
      }
    };
    
    // Store the function in a ref so we can access it from the interval
    loadStationDataRef.current = loadStationData;
    
    // Clear any existing timeout
    if (dataTimeoutRef.current) {
      clearTimeout(dataTimeoutRef.current);
    }
    
    // Create a debounced version that only triggers once after rapid changes
    dataTimeoutRef.current = setTimeout(() => {
      if (loadStationDataRef.current) {
        loadStationDataRef.current();
      }
    }, 300);
    
    // Set up refresh interval (every 30 seconds)
    const refreshInterval = setInterval(() => {
      if (loadStationDataRef.current) {
        loadStationDataRef.current();
      }
    }, 30000);
    
    return () => {
      isMounted = false;
      if (dataTimeoutRef.current) {
        clearTimeout(dataTimeoutRef.current);
      }
      clearInterval(refreshInterval);
    };
  }, [stationId, nearbyStations, allStations]);
  
  // Create stable memoized props for TransitMap
  const transitMapProps = useMemo(() => {
    if (!stableLocationRef.current) return null;
    
    return {
      location: stableLocationRef.current,
      nearbyStations,
      allStations,
      selectedStationId: stationId,
      onStationSelect: handleStationSelect,
      onMapMove: handleMapMove,
      height: "50vh",
      showLines: true,
      showAllStations: true,
      maxStationsToShow: 200
    };
  }, [nearbyStations, allStations, stationId, handleStationSelect, handleMapMove]);
  
  if (loading && !location) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-mta-blue"></div>
        <p className="mt-4 text-gray-600">Finding your location...</p>
      </div>
    );
  }
  
  if (error && !location) {
    return (
      <div className="min-h-screen p-4">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          <p className="font-bold">Error</p>
          <p>{error}</p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="w-full p-3 bg-mta-blue text-white rounded-lg"
        >
          Try Again
        </button>
      </div>
    );
  }
  
  return (
    <div className="relative flex flex-col h-screen">
      {/* Header with app title */}
      <header className="bg-mta-blue text-white p-4 shadow-md z-10">
        <h1 className="text-xl font-bold">Subway Reporter</h1>
        {stationInfo && (
          <p className="text-sm opacity-90">{stationInfo.name}</p>
        )}
      </header>
      
      {/* Layout container with map and info */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Map section */}
        <div className="relative">
          {transitMapProps && (
            <div className="transit-map-container" key="map-wrapper">
              <TransitMap {...transitMapProps} />
            </div>
          )}
          
          {/* Station picker floating control */}
          {showStationPicker && (
            <div className="absolute top-4 left-4 right-4 z-10 bg-white rounded-lg shadow-lg p-3">
              <label htmlFor="station-select" className="block text-sm font-medium text-gray-700 mb-1">
                Nearby stations:
              </label>
              <select
                id="station-select"
                value={stationId || ''}
                onChange={handleStationChange}
                className="w-full p-2 border border-gray-300 rounded-lg"
              >
                {nearbyStations.map(station => (
                  <option key={station.id} value={station.id}>
                    {station.name} ({station.distance ? `${Math.round(station.distance)}m` : ''})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        
        {/* Station details section */}
        <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
          {/* Station header */}
          <div className="mb-4 flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold">{stationInfo?.name || 'Select a Station'}</h1>
              {stationInfo?.lines && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {stationInfo.lines.map(line => (
                    <span 
                      key={line} 
                      className="inline-block px-2 py-1 rounded-full text-white text-xs font-bold"
                      style={{ backgroundColor: lineColors[line] || '#1a73e8' }}
                    >
                      {line}
                    </span>
                  ))}
                </div>
              )}
            </div>
            
            {isDataLoading && (
              <div className="flex items-center text-sm text-gray-500">
                <div className="animate-spin rounded-full h-3 w-3 border-t-1 border-b-1 border-mta-blue mr-2"></div>
                Updating...
              </div>
            )}
          </div>
          
          {/* Trains list */}
          {!stationInfo ? (
            <div className="bg-white rounded-lg p-4 text-center shadow">
              <p className="text-gray-600">Select a station to view train arrivals.</p>
            </div>
          ) : upcomingTrains.length === 0 ? (
            <div className="bg-white rounded-lg p-4 text-center shadow">
              <p className="text-gray-600">No upcoming trains found.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Upcoming Trains</h2>
              
              {upcomingTrains.map((train) => (
                <div key={train.id} className="bg-white rounded-lg shadow border border-gray-200">
                  <div className="p-4 border-b">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-xl font-bold`}
                             style={{backgroundColor: lineColors[train.line] || '#1a73e8'}}>
                          {train.line}
                        </div>
                        <div className="ml-3">
                          <div className="font-medium">{train.destination}</div>
                          <div className="text-sm text-gray-500">
                            {new Date(train.arrivalTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            {' · '}
                            {Math.round((new Date(train.arrivalTime) - new Date()) / 60000)} min
                            {train.delay > 0 && (
                              <span className="text-red-500 ml-1">
                                (Delayed {Math.floor(train.delay / 60)} min)
                              </span>
                            )}
                            {train.isRealtime && (
                              <span className="ml-2 px-1.5 py-0.5 bg-green-100 text-green-800 text-xs rounded">
                                Realtime
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-end">
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <svg 
                              key={star}
                              xmlns="http://www.w3.org/2000/svg" 
                              viewBox="0 0 24 24"
                              className={`w-5 h-5 ${star <= (train.currentRating || 5) ? 'text-yellow-500' : 'text-gray-300'}`}
                              fill="currentColor"
                            >
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                          ))}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {trainReports[train.id]?.length || 0} reports
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {trainReports[train.id] && trainReports[train.id].length > 0 && (
                    <TrainMap 
                      train={{
                        ...train,
                        cars: Array.from({ length: 10 }, (_, i) => ({
                          carNumber: `${train.line}${String(i + 1).padStart(3, '0')}`,
                          reports: trainReports[train.id].filter(r => r.carNumber === `${train.line}${String(i + 1).padStart(3, '0')}`)
                        }))
                      }} 
                      reports={trainReports[train.id]} 
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {/* Loading indicator overlay - only show during initial load */}
      {loading && (
        <div className="absolute inset-0 bg-black bg-opacity-20 flex items-center justify-center">
          <div className="bg-white p-4 rounded-lg shadow-lg flex items-center">
            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-mta-blue mr-3"></div>
            <p>Loading data...</p>
          </div>
        </div>
      )}
    </div>
  );
}