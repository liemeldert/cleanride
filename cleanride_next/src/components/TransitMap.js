'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import React from 'react';

// Fix for Leaflet default icon paths in Next.js
const DefaultIcon = L.icon({
  iconUrl: '/images/marker-icon.png',
  iconRetinaUrl: '/images/marker-icon-2x.png',
  shadowUrl: '/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

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

// Custom icons for stations based on transit lines
const createStationIcon = (lines, isSelected = false, isNearby = false) => {
  // Determine primary line color
  const primaryLine = lines && lines.length > 0 ? lines[0] : null;
  const color = primaryLine && lineColors[primaryLine] ? lineColors[primaryLine] : '#1a73e8';
  
  const size = isSelected ? 20 : (isNearby ? 16 : 12);
  const borderWidth = isSelected ? 3 : (isNearby ? 2 : 1);
  
  return L.divIcon({
    html: `
      <div style="
        background-color: ${color};
        width: ${size - 2*borderWidth}px;
        height: ${size - 2*borderWidth}px;
        border-radius: 50%;
        border: ${borderWidth}px solid white;
        box-shadow: 0 0 ${isSelected ? '8px rgba(0,0,0,0.6)' : (isNearby ? '4px rgba(0,0,0,0.4)' : '2px rgba(0,0,0,0.3)')};
      "></div>
    `,
    className: "station-marker",
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
  });
};

// Component to update map view when location changes
function MapCenterAdjuster({ location }) {
  const map = useMap();
  const prevLocationRef = useRef(location);
  
  useEffect(() => {
    // Only update if location has actually changed significantly
    if (location && prevLocationRef.current) {
      const prev = prevLocationRef.current;
      const distance = Math.sqrt(
        Math.pow(location.latitude - prev.latitude, 2) + 
        Math.pow(location.longitude - prev.longitude, 2)
      );
      
      // Only pan map if moved more than a small threshold
      if (distance > 0.0001) { // Approximately 10 meters
        map.setView([location.latitude, location.longitude], map.getZoom());
        prevLocationRef.current = location;
      }
    } else if (location) {
      map.setView([location.latitude, location.longitude], map.getZoom());
      prevLocationRef.current = location;
    }
  }, [location, map]);
  
  return null;
}

// Component to show map info and handle user interactions
function MapController({ onMapMove }) {
  const map = useMap();
  const moveTimeoutRef = useRef(null);
  
  useEffect(() => {
    // Set up event handlers for map movements with debounce
    const handleMoveEnd = () => {
      if (moveTimeoutRef.current) {
        clearTimeout(moveTimeoutRef.current);
      }
      
      moveTimeoutRef.current = setTimeout(() => {
        const center = map.getCenter();
        const bounds = map.getBounds();
        
        if (onMapMove) {
          onMapMove({
            latitude: center.lat,
            longitude: center.lng,
            bounds: {
              north: bounds.getNorth(),
              south: bounds.getSouth(),
              east: bounds.getEast(),
              west: bounds.getWest()
            }
          });
        }
      }, 300); // Increased debounce time for better performance
    };
    
    map.on('moveend', handleMoveEnd);
    map.on('zoomend', handleMoveEnd);
    
    // Trigger initial calculation (but with delay to avoid initial flicker)
    setTimeout(handleMoveEnd, 500);
    
    return () => {
      map.off('moveend', handleMoveEnd);
      map.off('zoomend', handleMoveEnd);
      if (moveTimeoutRef.current) {
        clearTimeout(moveTimeoutRef.current);
      }
    };
  }, [map, onMapMove]);
  
  return null;
}

const TransitMap = React.memo(function TransitMap({
  location,
  nearbyStations = [],
  allStations = [],
  selectedStationId,
  onStationSelect,
  onMapMove,
  height = '50vh',
  showLines = true,
  showAllStations = true,
  maxStationsToShow = 200, // Limit for performance
}) {
  const mapRef = useRef(null);
  const mapReadyRef = useRef(false); // Using ref instead of state
  const [transitLines, setTransitLines] = useState({});
  const [visibleStations, setVisibleStations] = useState([]);
  const [hoverStationId, setHoverStationId] = useState(null);
  
  // Determine which stations to display (nearby vs all based on zoom)
  const stationsToDisplay = useMemo(() => {
    // Start with nearby stations as a base - these will always be shown
    const baseStations = nearbyStations.map(s => ({...s, isNearby: true}));
    
    if (!showAllStations || allStations.length === 0) {
      return baseStations; // Fallback to nearby stations only
    }
    
    // Create a map of nearby station IDs for quick lookup
    const nearbyIds = new Set(nearbyStations.map(s => s.id));
    
    // If we have visible stations, add non-duplicate ones to the result
    if (visibleStations.length > 0) {
      // Filter visible stations to avoid duplicates with nearby stations
      const additionalStations = visibleStations
        .filter(s => !nearbyIds.has(s.id))
        .slice(0, Math.min(100, maxStationsToShow)) // Limit for performance
        .map(s => ({...s, isNearby: false}));
      
      // Combine nearby and visible stations
      const combined = [...baseStations, ...additionalStations];
      
      // Sort: nearby stations first, then by distance
      return combined.sort((a, b) => {
        if (a.isNearby && !b.isNearby) return -1;
        if (!a.isNearby && b.isNearby) return 1;
        return (a.distance || Infinity) - (b.distance || Infinity);
      });
    }
    
    return baseStations;
  }, [nearbyStations, allStations, visibleStations, showAllStations, maxStationsToShow]);
  
  // Handle hover state change
  const handleStationHover = useCallback((id) => {
    setHoverStationId(id);
  }, []);
  
  // Handle mouse leave
  const handleStationLeave = useCallback(() => {
    setHoverStationId(null);
  }, []);
  
  // Memoize the station markers to prevent re-renders
  const stationMarkers = useMemo(() => {
    return stationsToDisplay.map(station => (
      <Marker
        key={station.id}
        position={[station.location.lat, station.location.lon]}
        icon={createStationIcon(
          station.lines, 
          selectedStationId === station.id,
          station.isNearby || nearbyStations.some(s => s.id === station.id)
        )}
        eventHandlers={{
          click: () => {
            if (onStationSelect) {
              onStationSelect(station.id);
            }
          },
          mouseover: () => handleStationHover(station.id),
          mouseout: () => handleStationLeave()
        }}
      >
        <Popup>
          <div>
            <strong>{station.name}</strong>
            <div className="text-xs mt-1 flex flex-wrap gap-1">
              {station.lines?.map(line => (
                <span 
                  key={line} 
                  className="inline-block px-2 py-1 rounded-full text-white text-xs font-bold"
                  style={{ backgroundColor: lineColors[line] || '#1a73e8' }}
                >
                  {line}
                </span>
              ))}
            </div>
            {station.distance && (
              <div className="text-xs text-gray-600 mt-1">
                {Math.round(station.distance)}m away
              </div>
            )}
            <button 
              className={`mt-2 px-2 py-1 text-xs rounded w-full ${selectedStationId === station.id 
                ? 'bg-gray-300 text-gray-700' 
                : 'bg-blue-500 text-white'}`}
              onClick={(e) => {
                e.stopPropagation();
                if (onStationSelect) {
                  onStationSelect(station.id);
                }
              }}
            >
              {selectedStationId === station.id ? 'Selected' : 'Select This Station'}
            </button>
          </div>
        </Popup>
      </Marker>
    ));
  }, [stationsToDisplay, selectedStationId, onStationSelect, nearbyStations, handleStationHover, handleStationLeave]);
  
  // Memoize the transit lines to prevent recalculation
  const transitLinePolylines = useMemo(() => {
    if (!showLines) return [];
    
    return Object.entries(transitLines).map(([line, stations]) => {
      if (stations.length >= 2) {
        const color = lineColors[line] || '#1a73e8';
        const positions = stations.map(s => s.position);
        
        return (
          <Polyline
            key={`line-${line}`}
            positions={positions}
            pathOptions={{ 
              color: color, 
              weight: 4, 
              opacity: 0.7,
              lineCap: 'round',
              lineJoin: 'round'
            }}
          />
        );
      }
      return null;
    }).filter(Boolean); // Remove null values
  }, [transitLines, showLines]);
  
  // Handle map movement (used to filter visible stations)
  const handleMapMove = useCallback((mapInfo) => {
    if (allStations.length > 0) {
      // Filter stations to those within map bounds
      const bounds = mapInfo.bounds;
      const filtered = allStations.filter(station => 
        station.location &&
        station.location.lat >= bounds.south &&
        station.location.lat <= bounds.north &&
        station.location.lon >= bounds.west &&
        station.location.lon <= bounds.east
      ).slice(0, maxStationsToShow); // Limit for performance
      
      // Use functional update to avoid dependency on visibleStations
      setVisibleStations(prevStations => {
        // Only update if the stations actually changed
        const currentIds = new Set(prevStations.map(s => s.id));
        const filteredIds = new Set(filtered.map(s => s.id));
        
        if (filtered.length !== prevStations.length || 
            filtered.some(s => !currentIds.has(s.id)) || 
            prevStations.some(s => !filteredIds.has(s.id))) {
          return filtered;
        }
        return prevStations;
      });
    }
    
    // Pass the event to parent component
    if (onMapMove) {
      onMapMove(mapInfo);
    }
  }, [allStations, maxStationsToShow, onMapMove]);
  
  // Generate transit lines from stations
  const generateTransitLines = useCallback(() => {
    if (!showLines || !stationsToDisplay || stationsToDisplay.length === 0) {
      return {};
    }
    
    // Group stations by line
    const lines = {};
    
    stationsToDisplay.forEach(station => {
      if (station.lines && Array.isArray(station.lines)) {
        station.lines.forEach(line => {
          if (!lines[line]) lines[line] = [];
          lines[line].push({
            id: station.id,
            name: station.name,
            position: [station.location.lat, station.location.lon]
          });
        });
      }
    });
    
    // Only process lines with enough stations
    Object.keys(lines).forEach(line => {
      if (lines[line].length < 2) {
        delete lines[line];
        return;
      }
      
      // Simplified nearest-neighbor station sorting
      const stations = lines[line];
      const sortedStations = [stations[0]];
      const remaining = stations.slice(1);
      
      // Simple nearest-neighbor algorithm
      while (remaining.length > 0) {
        const last = sortedStations[sortedStations.length - 1];
        let bestIndex = 0;
        let bestDist = Infinity;
        
        for (let i = 0; i < remaining.length; i++) {
          const dist = Math.pow(last.position[0] - remaining[i].position[0], 2) + 
                       Math.pow(last.position[1] - remaining[i].position[1], 2);
          if (dist < bestDist) {
            bestDist = dist;
            bestIndex = i;
          }
        }
        
        sortedStations.push(remaining[bestIndex]);
        remaining.splice(bestIndex, 1);
      }
      
      lines[line] = sortedStations;
    });
    
    return lines;
  }, [stationsToDisplay, showLines]);
  
  // Initialize map once on mount
  useEffect(() => {
    // This ensures map is initialized after component mounts
    mapReadyRef.current = true;
    
    // Avoid network requests for marker images
    if (typeof window !== 'undefined') {
      console.info("Map initialized, marker images should be available");
    }
    
    // Clean-up function
    return () => {
      console.info("Map component unmounting - this should be rare");
    };
  }, []);
  
  // Update transit lines when stations change
  useEffect(() => {
    const lines = generateTransitLines();
    setTransitLines(prevLines => {
      // Only update if actually changed to prevent re-renders
      if (JSON.stringify(lines) !== JSON.stringify(prevLines)) {
        return lines;
      }
      return prevLines;
    });
  }, [generateTransitLines]);
  
  // Avoid unnecessary rendering of loading state if already shown the map
  if (!location) {
    return (
      <div 
        className="bg-gray-100 rounded-lg flex items-center justify-center" 
        style={{ height }}
      >
        <div className="text-gray-500">Loading map...</div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg overflow-hidden shadow-lg relative" style={{ height }}>
      <MapContainer
        key="transit-map" // Stable key to prevent recreation
        center={[location.latitude, location.longitude]}
        zoom={15}
        style={{ height: '100%', width: '100%' }}
        ref={mapRef}
        zoomControl={false}
        // Add these props to improve performance
        whenCreated={(map) => {
          // Store map instance in ref
          mapRef.current = map;
          // Disable unnecessary features
          map.attributionControl.setPrefix('');
          // Improve performance
          map.options.preferCanvas = true;
        }}
      >
        <ZoomControl position="topright" />
        
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          minZoom={10}
          keepBuffer={3}
          updateWhenZooming={false}
          updateWhenIdle={true}
          className="map-tiles"
        />
        
        {/* User location */}
        <Circle
          center={[location.latitude, location.longitude]}
          radius={50}
          pathOptions={{ fillColor: '#3b82f6', fillOpacity: 0.7, weight: 1, color: '#2563eb' }}
        >
          <Popup>You are here</Popup>
        </Circle>
        
        {/* Transit Lines */}
        {transitLinePolylines}
        
        {/* Markers for stations */}
        {stationMarkers}
        
        <MapCenterAdjuster location={location} />
        <MapController onMapMove={handleMapMove} />
      </MapContainer>
      
      {/* Station count indicator */}
      <div className="absolute bottom-2 right-2 bg-white bg-opacity-80 rounded-md px-2 py-1 text-xs shadow-sm">
        {stationsToDisplay.length} stations visible
      </div>
    </div>
  );
});

export default TransitMap;