import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import Station from '@/models/Station';

/**
 * Get all transit stations with optional filtering
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Get location parameters if provided (for sorting by distance)
    const lat = parseFloat(searchParams.get('lat') || 0);
    const lon = parseFloat(searchParams.get('lon') || 0);
    const limit = parseInt(searchParams.get('limit') || '500', 10);
    const lines = searchParams.get('lines')?.split(',') || null;
    
    // Connect to database
    await connectToDatabase();
    
    // Build query
    let query = {};
    if (lines) {
      query.lines = { $in: lines };
    }
    
    // Get all stations from database
    let stations = await Station.find(query).limit(limit);
    
    // If lat/lon provided, calculate distances and sort by proximity
    if (lat && lon) {
      stations = stations.map(station => {
        const stationObj = station.toObject();
        
        // Calculate distance using Haversine formula
        if (station.location && station.location.lat && station.location.lon) {
          const distance = calculateDistance(
            lat, lon,
            station.location.lat, station.location.lon
          );
          
          return {
            ...stationObj,
            distance
          };
        }
        
        return stationObj;
      });
      
      // Sort by distance
      stations.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
    }
    
    return NextResponse.json({
      count: stations.length,
      stations
    });
  } catch (error) {
    console.error('Error in GET /api/stations:', error);
    return NextResponse.json({ error: 'Failed to fetch stations' }, { status: 500 });
  }
}

/**
 * Calculate distance between two coordinates using the Haversine formula
 * @returns {number} Distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c * 1000; // Distance in meters
  
  return distance;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}