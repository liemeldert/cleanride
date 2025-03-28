import { NextResponse } from 'next/server';
import { getTrainArrivals } from '../../../lib/mtaApi';

export async function POST(request) {
  try {
    const { latitude, longitude } = await request.json();
    
    if (!latitude || !longitude) {
      return NextResponse.json(
        { error: 'Missing position data' }, 
        { status: 400 }
      );
    }
    
    // Get nearby stations from MTA API
    const stationData = await getTrainArrivals({ coords: { latitude, longitude } });
    
    // Get current time
    const now = new Date();
    
    // Find trains that are likely to be the one the user is on
    const nearbyTrains = stationData.data.list.filter(train => {
      const arrivalTime = new Date(train.expectedArrival);
      // If train arrived in the last 5 minutes
      return (now - arrivalTime) > 0 && (now - arrivalTime) < 5 * 60 * 1000;
    });
    
    if (nearbyTrains.length === 1) {
      return NextResponse.json(nearbyTrains[0]);
    } else if (nearbyTrains.length > 1) {
      return NextResponse.json({ multiplePossibilities: true, trains: nearbyTrains });
    }
    
    return NextResponse.json(null);
  } catch (error) {
    console.error('Error detecting train:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}