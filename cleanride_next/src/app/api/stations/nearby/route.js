import { NextResponse } from 'next/server';
import { findNearestStation, getStations } from '../../../../lib/gtfsData';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = parseFloat(searchParams.get('lat'));
    const lon = parseFloat(searchParams.get('lon'));
    const radius = parseInt(searchParams.get('radius') || '1000', 10); // Default 1000m radius
    const limit = parseInt(searchParams.get('limit') || '5', 10); // Default 5 stations
    
    if (isNaN(lat) || isNaN(lon)) {
      return NextResponse.json(
        { error: 'Valid latitude and longitude are required' }, 
        { status: 400 }
      );
    }
    
    // Get all stations
    const allStations = await getStations();
    
    if (!allStations || allStations.length === 0) {
      return NextResponse.json(
        { error: 'No stations found in database' }, 
        { status: 404 }
      );
    }
    
    // Calculate distance to each station
    const stationsWithDistance = allStations.map(station => {
      const distance = calculateDistance(
        lat, lon, 
        station.location.lat, 
        station.location.lon
      );
      
      return { ...station, distance };
    });
    
    // Filter by radius
    const stationsInRadius = stationsWithDistance.filter(station => 
      station.distance <= radius
    );
    
    // Sort by distance
    stationsInRadius.sort((a, b) => a.distance - b.distance);
    
    // Limit results
    const limitedStations = stationsInRadius.slice(0, limit);
    
    return NextResponse.json({
      stations: limitedStations.map(station => ({
        id: station.id,
        name: station.name,
        lines: station.lines,
        location: station.location,
        distance: Math.round(station.distance)
      }))
    }, { status: 200 });
  } catch (error) {
    console.error('Error in GET /api/stations/nearby:', error);
    return NextResponse.json({ error: 'Failed to fetch nearby stations' }, { status: 500 });
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