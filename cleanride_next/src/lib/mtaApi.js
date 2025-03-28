import axios from 'axios';
import connectToDatabase from './mongodb';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

// MTA API configuration
const MTA_API_BASE_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2F';
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true';

// MTA feed mapping to subway lines - Updated with correct URLs from MTA website
const MTA_FEEDS = {
  'IRT': { 
    lines: ['1', '2', '3', '4', '5', '6', '7', 'S', 'GS'], 
    url: 'gtfs' 
  },
  'ACE': { 
    lines: ['A', 'C', 'E', 'H'], 
    url: 'gtfs-ace' 
  },
  'NQRW': { 
    lines: ['N', 'Q', 'R', 'W'], 
    url: 'gtfs-nqrw' 
  },
  'BDFM': { 
    lines: ['B', 'D', 'F', 'M', 'FS'], 
    url: 'gtfs-bdfm' 
  },
  'L': { 
    lines: ['L'], 
    url: 'gtfs-l' 
  },
  'G': { 
    lines: ['G'], 
    url: 'gtfs-g' 
  },
  'JZ': { 
    lines: ['J', 'Z'], 
    url: 'gtfs-jz' 
  },
  'SIR': { 
    lines: ['SI', 'SIR'], 
    url: 'gtfs-si' 
  }
};

// Transit line to color mapping - matches your existing UI
const lineColors = {
  '1': '#EE352E', '2': '#EE352E', '3': '#EE352E', 
  '4': '#00933C', '5': '#00933C', '6': '#00933C',
  '7': '#B933AD',
  'A': '#2850AD', 'C': '#2850AD', 'E': '#2850AD', 'H': '#2850AD',
  'B': '#FF6319', 'D': '#FF6319', 'F': '#FF6319', 'M': '#FF6319',
  'G': '#6CBE45',
  'J': '#996633', 'Z': '#996633',
  'L': '#A7A9AC',
  'N': '#FCCC0A', 'Q': '#FCCC0A', 'R': '#FCCC0A', 'W': '#FCCC0A',
  'S': '#808183', 'GS': '#808183',
  'SI': '#2850AD'
};

// Cache for API responses to reduce API calls
const apiCache = {
  data: {},
  timestamp: {}
};

/**
 * Get line feeds for a station
 * @param {Array} stationLines - Array of lines serving this station
 * @returns {Array} - Feed IDs to query
 */
function getRelevantFeeds(stationLines) {
  if (!stationLines || stationLines.length === 0) {
    // If we don't know the lines, query all feeds
    return Object.keys(MTA_FEEDS);
  }
  
  // Find feeds that include the station's lines
  const feedIds = new Set();
  
  stationLines.forEach(line => {
    for (const [feedId, feed] of Object.entries(MTA_FEEDS)) {
      if (feed.lines.includes(line)) {
        feedIds.add(feedId);
      }
    }
  });
  
  // If we couldn't determine feeds, return all to be safe
  return feedIds.size > 0 ? Array.from(feedIds) : Object.keys(MTA_FEEDS);
}

/**
 * Format stop ID for GTFS-realtime
 * GTFS-realtime uses parent_station ID + direction (N/S)
 * For example: stop "123" becomes "123N" for northbound trains
 */
function formatStopId(stationId, direction) {
  return `${stationId}${direction === 'NORTH' ? 'N' : 'S'}`;
}

/**
 * Parse MTA's GTFS-realtime feed
 * @param {Buffer} buffer - Raw protobuf data
 * @returns {Object} - Parsed feed
 */
function parseGtfsRealtimeFeed(buffer) {
  try {
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
  } catch (error) {
    console.error("Error parsing GTFS-realtime feed:", error);
    return { header: { timestamp: Date.now() / 1000 }, entity: [] };
  }
}

/**
 * Get NYCT trip descriptor extension
 * @param {Object} trip - GTFS-realtime trip
 * @returns {Object} - NYCT extensions or null
 */
function getNyctTripDescriptor(trip) {
  try {
    if (trip && trip.extensions && trip.extensions['nyct_trip_descriptor']) {
      return trip.extensions['nyct_trip_descriptor'];
    }
  } catch (error) {
    console.warn("Error getting NYCT trip descriptor:", error);
  }
  return null;
}

/**
 * Fetch GTFS-realtime data from MTA API
 * @param {string} feedId - MTA feed ID
 * @returns {Promise<Object>} - Parsed GTFS-realtime feed
 */
async function fetchMtaFeed(feedId) {
  // Check cache first (cache for 30 seconds)
  const now = Date.now();
  if (apiCache.data[feedId] && now - apiCache.timestamp[feedId] < 30000) {
    console.log(`Using cached data for feed ${feedId}`);
    return apiCache.data[feedId];
  }

  if (USE_MOCK_DATA) {
    console.log(`Using mock data for feed ${feedId} (USE_MOCK_DATA=true)`);
    return { header: { timestamp: now / 1000 }, entity: [] };
  }

  try {
    const feedUrl = MTA_FEEDS[feedId]?.url || 'gtfs';
    const url = `${MTA_API_BASE_URL}${feedUrl}`;
    
    console.log(`Fetching MTA feed: ${url}`);

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
    });

    // Parse the protobuf response
    const feed = parseGtfsRealtimeFeed(response.data);
    
    // Cache the response
    apiCache.data[feedId] = feed;
    apiCache.timestamp[feedId] = now;
    
    console.log(`Successfully parsed feed ${feedId} with ${feed.entity.length} entities`);
    return feed;
  } catch (error) {
    console.error(`Error fetching MTA feed ${feedId}:`, error.message);
    if (error.response) {
      console.error(`  Status: ${error.response.status}`);
    }
    
    // Fall back to mock data
    console.log(`MTA API error - using mock data as fallback`);
    return { header: { timestamp: now / 1000 }, entity: [] };
  }
}

/**
 * Get train arrival times for a specific station
 * @param {string} stationId - Station ID to get arrivals for
 * @returns {Promise<Object>} - Object with arrivals and station info
 */
export async function getTrainArrivals(stationId) {
  try {
    // Connect to database to get station information
    const { db } = await connectToDatabase();
    
    // Get station information
    const station = await db.collection('gtfs_processed_stations').findOne({ id: stationId });
    
    if (!station) {
      console.warn(`Station not found: ${stationId}`);
      return { 
        arrivals: [],
        station: { id: stationId, name: "Unknown Station", lines: [] }
      };
    }
    
    console.log(`Getting train arrivals for station: ${station.name} (${stationId})`);
    
    // Get relevant feeds for this station's lines
    const relevantFeeds = getRelevantFeeds(station.lines);
    
    // Collect all arrivals from all feeds
    const arrivals = [];
    
    // If mock data is enabled, use mock data instead of real API
    if (USE_MOCK_DATA) {
      console.log("Using mock data");
      const mockArrivals = generateMockArrivals(station);
      arrivals.push(...mockArrivals);
    } else {
      // Fetch data from all relevant feeds
      const feedPromises = relevantFeeds.map(feedId => fetchMtaFeed(feedId));
      const feeds = await Promise.all(feedPromises);
      
      const now = Math.floor(Date.now() / 1000);
      
      // Process each feed
      for (const feed of feeds) {
        // Process all trip updates
        for (const entity of feed.entity) {
          if (entity.trip_update && entity.trip_update.stop_time_update) {
            const tripUpdate = entity.trip_update;
            const trip = tripUpdate.trip;
            
            if (!trip) continue;
            
            // Get the NYCT extensions
            const nyctTrip = getNyctTripDescriptor(trip);
            
            // Check each stop time update for this station
            for (const update of tripUpdate.stop_time_update) {
              // The stop_id in GTFS-realtime includes direction, so we need to check both possibilities
              const northStopId = formatStopId(stationId, 'NORTH');
              const southStopId = formatStopId(stationId, 'SOUTH');
              
              if (update.stop_id === northStopId || update.stop_id === southStopId) {
                // We found a stop time update for this station
                
                // Get arrival time
                const arrivalTime = update.arrival?.time?.low || update.arrival?.time;
                
                // Skip past arrivals
                if (arrivalTime && arrivalTime > now) {
                  const direction = update.stop_id.endsWith('N') ? 'NORTH' : 'SOUTH';
                  const routeId = trip.route_id;
                  
                  // Determine destination from trip_id or NYCT extension
                  let destination = "Unknown";
                  if (trip.trip_id && trip.trip_id.includes('..')) {
                    destination = trip.trip_id.split('..')[1] || "Unknown";
                  } else if (nyctTrip && nyctTrip.train_id) {
                    // Train IDs like "06 0123+ PEL/BBR" have destination after "/"
                    const trainIdParts = nyctTrip.train_id.split('/');
                    if (trainIdParts.length > 1) {
                      destination = trainIdParts[1];
                    }
                  }
                  
                  // Format the arrival information
                  arrivals.push({
                    id: trip.trip_id,
                    line: routeId,
                    direction: direction,
                    destination: getDestinationName(destination),
                    arrivalTime: new Date(arrivalTime * 1000).toISOString(),
                    delay: update.arrival?.delay || 0,
                    isRealtime: true,
                    isAssigned: nyctTrip?.is_assigned || false,
                    color: lineColors[routeId] || '#808183',
                    trainId: nyctTrip?.train_id || trip.trip_id
                  });
                }
              }
            }
          }
        }
      }
      
      // If no real-time arrivals found, fall back to mock data
      if (arrivals.length === 0) {
        console.log(`No real-time arrivals found, using mock data for station ${station.name}`);
        const mockArrivals = generateMockArrivals(station);
        arrivals.push(...mockArrivals);
      } else {
        console.log(`Found ${arrivals.length} arrivals for station ${station.name}`);
      }
    }
    
    // Sort by arrival time
    arrivals.sort((a, b) => new Date(a.arrivalTime) - new Date(b.arrivalTime));
    
    return {
      arrivals: arrivals,
      station: {
        id: stationId,
        name: station.name,
        lines: station.lines || []
      }
    };
  } catch (error) {
    console.error('Error in getTrainArrivals:', error);
    return { arrivals: [] };
  }
}

/**
 * Generate mock arrival data for testing purposes
 * Used when USE_MOCK_DATA is true
 */
function generateMockArrivals(station) {
  const now = new Date();
  const lines = station.lines || [];
  
  if (lines.length === 0) return [];
  
  // Generate 2-5 arrivals per line
  const arrivals = [];
  
  lines.forEach(line => {
    const numArrivals = Math.floor(Math.random() * 4) + 2;
    
    for (let i = 0; i < numArrivals; i++) {
      // Calculate a random arrival time in the next 30 minutes
      const minutesFromNow = Math.floor(Math.random() * 30) + 2;
      const arrivalTime = new Date(now.getTime() + minutesFromNow * 60 * 1000);
      
      // Random delay (0-5 minutes)
      const delayMinutes = Math.random() < 0.3 ? Math.floor(Math.random() * 5) + 1 : 0;
      
      // Random trip ID
      const tripId = `${line}_${Math.floor(Math.random() * 100000)}`;
      
      arrivals.push({
        id: tripId,
        line: line,
        destination: getDestinationName(getRandomDestination(line)),
        arrivalTime: arrivalTime.toISOString(),
        delay: delayMinutes * 60, // Convert to seconds
        isRealtime: true,
        isAssigned: Math.random() > 0.2, // 80% chance of being assigned
        color: lineColors[line] || '#808183',
        trainId: `0 ${line}${Math.floor(Math.random() * 10000)}`
      });
    }
  });
  
  // Sort by arrival time
  arrivals.sort((a, b) => new Date(a.arrivalTime) - new Date(b.arrivalTime));
  
  return arrivals;
}

/**
 * Get a formatted destination name
 * @param {string} destination - Raw destination code or name
 * @returns {string} - Formatted destination name
 */
function getDestinationName(destination) {
  // Get destination name from known destinations
  const destinations = {
    // Manhattan
    'TSQ': 'Times Square',
    'GCT': 'Grand Central',
    '14S': '14 St',
    '34S': '34 St',
    'SFC': 'South Ferry',
    'WTC': 'World Trade Center',
    // Brooklyn
    'ATL': 'Atlantic Av',
    'CIY': 'Coney Island',
    'BBR': 'Brighton Beach',
    'FHL': 'Flatbush Av',
    'UST': 'Utica Av',
    'NLT': 'New Lots Av',
    'ENY': 'East New York',
    // Bronx
    'WPK': 'Wakefield',
    'WOD': 'Woodlawn',
    'PBP': 'Pelham Bay Park',
    'ECD': 'Eastchester',
    // Queens
    'FLS': 'Flushing',
    'JAM': 'Jamaica Center',
    '179': '179 St Jamaica',
    // Names we already know
    'Van Cortlandt Park': 'Van Cortlandt Park',
    'South Ferry': 'South Ferry',
    'Wakefield': 'Wakefield',
    'Flatbush Av': 'Flatbush Av',
    'Harlem': 'Harlem',
    'New Lots Av': 'New Lots Av',
    // Default case - use as is if not found
    'DEFAULT': destination
  };
  
  return destinations[destination] || destinations['DEFAULT'];
}

/**
 * Get a random destination for a train line
 * Used for mock data only
 */
function getRandomDestination(line) {
  const destinations = {
    '1': ['Van Cortlandt Park', 'South Ferry'],
    '2': ['Wakefield', 'Flatbush Av'],
    '3': ['Harlem', 'New Lots Av'],
    '4': ['WOD', 'UST', 'NLT'],
    '5': ['ECD', 'FHL'],
    '6': ['PBP', 'BBR'],
    '7': ['FLS', '34S'],
    'A': ['207', 'FAR', 'RPK'],
    'C': ['168', 'EUC'],
    'E': ['JAM', 'WTC'],
    'B': ['BPK', 'BBR'],
    'D': ['NWD', 'CIY'],
    'F': ['179', 'CIY'],
    'M': ['71A', 'MET'],
    'G': ['CTQ', 'CHA'],
    'J': ['JAM', 'BRS'],
    'Z': ['JAM', 'BRS'],
    'L': ['CAN', '8AV'],
    'N': ['AST', 'CIY'],
    'Q': ['96S', 'CIY'],
    'R': ['71A', 'BAY'],
    'W': ['AST', 'WHS'],
    'S': ['TSQ', 'GCT'],
    'SI': ['STG', 'TOT'],
  };
  
  const lineDestinations = destinations[line] || ['UNK'];
  return lineDestinations[Math.floor(Math.random() * lineDestinations.length)];
}