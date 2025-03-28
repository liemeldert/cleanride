import { NextResponse } from 'next/server';
import { getStationSchedule } from '../../../../lib/gtfsData';
import { getTrainArrivals } from '../../../../lib/mtaApi';
import connectToDatabase from '../../../../lib/mongodb';
import Train from '../../../../models/Train';

/**
 * Get station information, scheduled departures, and real-time arrivals
 */
export async function GET(request, context) {
  try {
    // Fix for Next.js App Router - await the params object
    const params = await context.params;
    const stationId = params.stationId;
    
    // Add this debug log to see what's being received
    console.log(`API received stationId: ${stationId}`);
    
    if (!stationId) {
      return NextResponse.json({ error: 'Station ID is required' }, { status: 400 });
    }
    
    const { searchParams } = new URL(request.url);
    
    // Get options from query parameters
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const useRealtime = searchParams.get('realtime') !== 'false'; // Default to true
    const dataType = searchParams.get('dataType') || 'supplemented';
    const route = searchParams.get('route') || null;
    
    console.log(`Fetching data for station: ${stationId}, realtime: ${useRealtime}, route: ${route || 'all'}`);
    
    // Connect to database
    const { db } = await connectToDatabase();
    
    // Do a more exhaustive search for the station in various formats
    console.log(`Searching for station ID: ${stationId} in database`);
    const stationQueries = [
      { id: stationId }, 
      { id: stationId.toString() },
      { parent_station: stationId },
      // Try without trailing N/S if present (A31N → A31)
      { id: stationId.replace(/[NS]$/, '') },
      // Try with parent_station for stop_id format
      { 'child_stops.id': stationId }
    ];
    
    let stationExists = null;
    
    for (const query of stationQueries) {
      console.log(`Trying query:`, query);
      const result = await db.collection('gtfs_processed_stations').findOne(query);
      if (result) {
        stationExists = result;
        console.log(`Found station with query:`, query);
        break;
      }
    }
    
    // If still not found, try a more flexible search by substring
    if (!stationExists && stationId.length >= 2) {
      console.log(`Trying flexible search with regex`);
      const regexSearch = new RegExp(stationId.replace(/[NS]$/, ''), 'i');
      stationExists = await db.collection('gtfs_processed_stations').findOne({
        $or: [
          { id: { $regex: regexSearch } },
          { 'child_stops.id': { $regex: regexSearch } }
        ]
      });
      
      if (stationExists) {
        console.log(`Found station with regex search: ${stationExists.id}`);
      }
    }
    
    if (!stationExists) {
      // Last resort - list available stations for debugging
      const availableStations = await db.collection('gtfs_processed_stations')
        .find({})
        .limit(5)
        .project({ id: 1, name: 1 })
        .toArray();
        
      console.log(`Station not found: ${stationId}. Available stations sample:`, 
        availableStations.map(s => `${s.id} (${s.name})`));
        
      return NextResponse.json({ error: 'Station not found' }, { status: 404 });
    }
    
    // Get scheduled departures from GTFS data
    const scheduledDepartures = await getStationSchedule(stationId, {
      limit,
      dataType,
      route,
      timeRange: 7200 // 2 hours
    });
    
    console.log(`Found ${scheduledDepartures.length} scheduled departures`);
    
    // Get real-time arrivals if requested
    let realtimeArrivals = [];
    if (useRealtime) {
      try {
        // Fetch realtime data from MTA API
        const mtaData = await getTrainArrivals(stationId);
        
        // Process MTA data and merge with our database
        realtimeArrivals = await Promise.all(mtaData.arrivals.map(async (train) => {
          // Try to find existing train ratings in our DB
          const trainInfo = await Train.findOne({ trainId: train.id });
          
          return {
            id: train.id,
            line: train.line,
            destination: train.destination,
            arrivalTime: train.arrivalTime,
            currentRating: trainInfo?.currentRating || 5,
            color: train.color,
            delay: train.delay || 0,
            isRealtime: true,
            trainId: train.trainId || train.id
          };
        }));
        
        console.log(`Found ${realtimeArrivals.length} realtime arrivals`);
      } catch (error) {
        console.error('Error fetching real-time data:', error);
        // Continue without real-time data
      }
    }
    
    // Combine and deduplicate the data
    const combinedArrivals = [...realtimeArrivals];
    
    // Add scheduled departures that don't have a real-time equivalent
    scheduledDepartures.forEach(scheduled => {
      const hasRealtime = realtimeArrivals.some(
        rt => rt.line === scheduled.route_short_name && 
             Math.abs(new Date(rt.arrivalTime) - new Date(scheduled.arrival_timestamp)) < 120000 // Within 2 minutes
      );
      
      if (!hasRealtime) {
        combinedArrivals.push({
          id: scheduled.trip_id,
          line: scheduled.route_short_name,
          destination: scheduled.headsign,
          arrivalTime: scheduled.arrival_timestamp,
          color: scheduled.route_color || getLineColor(scheduled.route_short_name),
          delay: 0,
          isRealtime: false
        });
      }
    });
    
    // Sort by arrival time
    combinedArrivals.sort((a, b) => new Date(a.arrivalTime) - new Date(b.arrivalTime));
    
    // Filter out arrivals that have already passed
    const now = new Date();
    const filteredArrivals = combinedArrivals.filter(arrival => 
      new Date(arrival.arrivalTime) > now
    );
    
    // Add delay information as a human-readable field
    const arrivalsWithInfo = filteredArrivals.map(arrival => {
      const arrivalDate = new Date(arrival.arrivalTime);
      const minutesUntil = Math.round((arrivalDate - now) / 60000);
      const delayMinutes = Math.round(arrival.delay / 60);
      
      return {
        ...arrival,
        minutesUntil,
        delayMinutes,
        delayInfo: arrival.delay > 0 ? `Delayed ${delayMinutes} min` : null
      };
    });
    
    // Limit results
    const limitedArrivals = arrivalsWithInfo.slice(0, limit);
    
    // Get station details
    const stationDetails = {
      id: stationId,
      name: stationExists.name,
      lines: stationExists.lines || [],
      location: stationExists.location,
      scheduled: scheduledDepartures.length,
      realtime: realtimeArrivals.length
    };
    
    return NextResponse.json({
      station: stationDetails,
      arrivals: limitedArrivals
    });
  } catch (error) {
    console.error('Error in GET /api/station/[stationId]:', error);
    return NextResponse.json({ error: 'Failed to fetch station data' }, { status: 500 });
  }
}

/**
 * Helper function to get color for a line
 */
function getLineColor(line) {
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
  
  return lineColors[line] || '#808183';
}