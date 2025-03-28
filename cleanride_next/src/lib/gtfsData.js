import connectToDatabase from './mongodb';

/**
 * Fetch stations from MongoDB
 * @param {Object} [query] - Optional query to filter stations
 * @param {Object} [options] - Query options
 * @returns {Promise<Array>} - List of stations
 */
export async function getStations(query = {}, options = {}) {
  try {
    const { db } = await connectToDatabase();
    
    // Default to returning the latest data type (supplemented if available)
    if (!query.data_type) {
      // Check if supplemented data exists
      const hasSupplemented = await db
        .collection('gtfs_processed_stations')
        .findOne({ data_type: 'supplemented' });
      
      if (hasSupplemented) {
        query.data_type = 'supplemented';
      } else {
        query.data_type = 'regular';
      }
    }
    
    // Set default sort by name if not specified
    const sort = options.sort || { name: 1 };
    
    // Set default limit
    const limit = options.limit || 0;
    
    // Perform the query
    const stations = await db
      .collection('gtfs_processed_stations')
      .find(query)
      .sort(sort)
      .limit(limit)
      .toArray();
    
    return stations;
  } catch (error) {
    console.error('Error fetching stations:', error);
    return [];
  }
}

/**
 * Find the nearest station to given coordinates
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {number} [maxDistance=1000] - Maximum distance in meters
 * @param {string} [dataType] - Data type to use (regular or supplemented)
 * @returns {Promise<Object|null>} - The nearest station or null if none found
 */
export async function findNearestStation(lat, lon, maxDistance = 1000, dataType = null) {
  try {
    const { db } = await connectToDatabase();
    
    // Parse coordinates as numbers
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);
    
    if (isNaN(latitude) || isNaN(longitude)) {
      throw new Error('Invalid coordinates');
    }
    
    // Determine data type to use
    const dataTypeQuery = dataType ? { data_type: dataType } : {};
    
    // First attempt with geospatial query if 2dsphere index exists
    try {
      // Check if the 2dsphere index exists
      const indexes = await db.collection('gtfs_processed_stations').indexes();
      const has2dIndex = indexes.some(idx => 
        idx.key && (idx.key.location === '2dsphere' || idx.key['location.geo'] === '2dsphere')
      );
      
      if (has2dIndex) {
        // Use $geoNear aggregation
        const result = await db.collection('gtfs_processed_stations').aggregate([
          {
            $geoNear: {
              near: { type: "Point", coordinates: [longitude, latitude] },
              distanceField: "distance",
              maxDistance: maxDistance,
              spherical: true,
              query: dataTypeQuery
            }
          },
          { $limit: 1 }
        ]).toArray();
        
        if (result.length > 0) {
          return result[0];
        }
      }
    } catch (indexError) {
      console.warn('Geospatial query failed, falling back to manual distance calculation:', indexError);
    }
    
    // Fallback: manual distance calculation
    // Get all stations with the specified data type
    const stations = await getStations(dataTypeQuery);
    
    if (stations.length === 0) {
      return null;
    }
    
    // Calculate distances
    const stationsWithDistance = stations.map(station => {
      const distance = calculateDistance(
        latitude, longitude,
        station.location.lat, station.location.lon
      );
      return { ...station, distance };
    });
    
    // Sort by distance
    stationsWithDistance.sort((a, b) => a.distance - b.distance);
    
    // Return the closest station within max distance
    if (stationsWithDistance[0].distance <= maxDistance) {
      return stationsWithDistance[0];
    }
    
    return null;
  } catch (error) {
    console.error('Error finding nearest station:', error);
    return null;
  }
}

/**
 * Get schedule information for a station
 * @param {string} stationId - Station ID
 * @param {Object} options - Options for the query
 * @returns {Promise<Array>} - List of scheduled departures
 */
export async function getStationSchedule(stationId, options = {}) {
  try {
    const { db } = await connectToDatabase();
    
    // Get the current date and time
    const now = new Date();
    const currentTime = now.toTimeString().substring(0, 8); // HH:MM:SS
    const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()];
    const dateString = now.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
    
    // Determine data type to use
    const dataType = options.dataType || 'supplemented';
    
    // Get station information
    const station = await db.collection('gtfs_processed_stations').findOne({ 
      id: stationId,
      data_type: dataType
    });
    
    if (!station) {
      console.warn(`Station not found: ${stationId}`);
      return [];
    }
    
    // Get all stop IDs for this station (including child stops)
    const stopIds = station.child_stops.map(stop => stop.id);
    if (station.location_type === 0) {
      // Also include the station ID itself if it's a stop
      stopIds.push(stationId);
    }
    
    if (stopIds.length === 0) {
      console.warn(`No stops found for station: ${stationId}`);
      return [];
    }
    
    // Find service IDs in effect today
    const serviceIds = await db.collection('gtfs_calendar').find({
      [dayOfWeek]: 1, // e.g., monday: 1
      start_date: { $lte: dateString },
      end_date: { $gte: dateString },
      data_type: dataType
    }).project({ service_id: 1 }).map(doc => doc.service_id).toArray();
    
    if (serviceIds.length === 0) {
      console.warn(`No service IDs found for today (${dayOfWeek})`);
      return [];
    }
    
    // Filter by route if provided
    const routeFilter = options.route ? { route_id: options.route } : {};
    
    // Find trips running today on the specified routes
    const trips = await db.collection('gtfs_trips').find({
      service_id: { $in: serviceIds },
      ...routeFilter,
      data_type: dataType
    }).toArray();
    
    if (trips.length === 0) {
      console.warn(`No trips found for today with the specified filters`);
      return [];
    }
    
    const tripIds = trips.map(trip => trip.trip_id);
    
    // Get stop times for these stops and trips
    const stopTimes = await db.collection('gtfs_stop_times').find({
      stop_id: { $in: stopIds },
      trip_id: { $in: tripIds },
      arrival_time: { $gte: currentTime },
      data_type: dataType
    }).sort({ arrival_time: 1 })
      .limit(options.limit || 20)
      .toArray();
    
    if (stopTimes.length === 0) {
      console.warn(`No stop times found for the specified stops and trips`);
      return [];
    }
    
    // Create lookup maps for trips and routes
    const tripMap = {};
    trips.forEach(trip => {
      tripMap[trip.trip_id] = trip;
    });
    
    // Get route information
    const routeIds = [...new Set(trips.map(trip => trip.route_id))];
    const routes = await db.collection('gtfs_routes').find({
      route_id: { $in: routeIds },
      data_type: dataType
    }).toArray();
    
    const routeMap = {};
    routes.forEach(route => {
      routeMap[route.route_id] = route;
    });
    
    // Format the results
    return stopTimes.map(st => {
      const trip = tripMap[st.trip_id] || {};
      const route = routeMap[trip.route_id] || {};
      
      // Parse arrival and departure times
      const arrivalParts = st.arrival_time ? st.arrival_time.split(':') : [0, 0, 0];
      const departureParts = st.departure_time ? st.departure_time.split(':') : [0, 0, 0];
      
      // Create arrival and departure Date objects
      const arrivalDate = new Date(now);
      arrivalDate.setHours(parseInt(arrivalParts[0]), parseInt(arrivalParts[1]), parseInt(arrivalParts[2]));
      
      const departureDate = new Date(now);
      departureDate.setHours(parseInt(departureParts[0]), parseInt(departureParts[1]), parseInt(departureParts[2]));
      
      // Handle times past midnight
      if (parseInt(arrivalParts[0]) >= 24) {
        arrivalDate.setDate(arrivalDate.getDate() + 1);
        arrivalDate.setHours(parseInt(arrivalParts[0]) - 24, parseInt(arrivalParts[1]), parseInt(arrivalParts[2]));
      }
      
      if (parseInt(departureParts[0]) >= 24) {
        departureDate.setDate(departureDate.getDate() + 1);
        departureDate.setHours(parseInt(departureParts[0]) - 24, parseInt(departureParts[1]), parseInt(departureParts[2]));
      }
      
      return {
        trip_id: st.trip_id,
        stop_id: st.stop_id,
        arrival_time: st.arrival_time,
        departure_time: st.departure_time,
        arrival_timestamp: arrivalDate.toISOString(),
        departure_timestamp: departureDate.toISOString(),
        stop_sequence: st.stop_sequence,
        headsign: trip.trip_headsign || '',
        route_id: trip.route_id || '',
        route_short_name: route.route_short_name || route.route_id || '',
        route_long_name: route.route_long_name || '',
        route_color: route.route_color || '',
        direction_id: trip.direction_id,
        wheelchair_accessible: trip.wheelchair_accessible || 0
      };
    });
  } catch (error) {
    console.error('Error getting station schedule:', error);
    return [];
  }
}

/**
 * Get GTFS metadata
 * @param {string} [dataType] - Optional data type filter ('regular' or 'supplemented')
 * @returns {Promise<Object|Array>} - Metadata object or array
 */
export async function getGtfsMetadata(dataType = null) {
  try {
    const { db } = await connectToDatabase();
    
    const query = dataType ? { data_type: dataType } : {};
    const metadata = await db.collection('gtfs_metadata').find(query).toArray();
    
    return dataType ? metadata[0] || null : metadata;
  } catch (error) {
    console.error('Error fetching GTFS metadata:', error);
    return dataType ? null : [];
  }
}

/**
 * Search for stations by name
 * @param {string} searchTerm - The search term
 * @param {string} [dataType] - Optional data type filter
 * @param {number} [limit=10] - Maximum number of results to return
 * @returns {Promise<Array>} - List of matching stations
 */
export async function searchStations(searchTerm, dataType = null, limit = 10) {
  try {
    const { db } = await connectToDatabase();
    
    // Determine data type to use
    const dataTypeQuery = dataType ? { data_type: dataType } : {};
    
    // Create a case-insensitive regex for the search term
    const searchRegex = new RegExp(searchTerm, 'i');
    
    // Search for stations matching the name
    const stations = await db.collection('gtfs_processed_stations').find({
      name: searchRegex,
      ...dataTypeQuery
    }).limit(limit).toArray();
    
    return stations;
  } catch (error) {
    console.error('Error searching stations:', error);
    return [];
  }
}

/**
 * Get all routes
 * @param {string} [dataType] - Optional data type filter
 * @returns {Promise<Array>} - List of routes
 */
export async function getRoutes(dataType = null) {
  try {
    const { db } = await connectToDatabase();
    
    // Determine data type to use
    const dataTypeQuery = dataType ? { data_type: dataType } : {};
    
    // Get all routes
    const routes = await db.collection('gtfs_routes').find(dataTypeQuery).toArray();
    
    return routes;
  } catch (error) {
    console.error('Error fetching routes:', error);
    return [];
  }
}

/**
 * Calculate distance between two points
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c;
}