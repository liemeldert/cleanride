import { NextResponse } from 'next/server';
import { getTrainArrivals } from '@/lib/mtaApi';
import connectToDatabase from '@/lib/mongodb';
import Train from '@/models/Train';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const stationId = searchParams.get('stationId');
    
    if (!stationId) {
      return NextResponse.json(
        { error: 'Station ID is required' }, 
        { status: 400 }
      );
    }
    
    // Get upcoming train arrivals from MTA API
    const mtaData = await getTrainArrivals({ 
      lat: searchParams.get('lat') || stationId.split(',')[0],
      lon: searchParams.get('lon') || stationId.split(',')[1]
    });
    
    // Connect to database for train ratings
    await connectToDatabase();
    
    // Process MTA data and merge with our database info
    const now = new Date();
    const upcomingTrains = mtaData.data.list
      .filter(train => new Date(train.expectedArrival) > now)
      .map(async (train) => {
        // Try to find existing train ratings in our DB
        const trainInfo = await Train.findOne({ trainId: train.tripId });
        
        return {
          id: train.tripId,
          line: train.route,
          destination: train.headsign,
          arrivalTime: train.expectedArrival,
          currentRating: trainInfo?.currentRating || 5,
          color: train.color || getColorForLine(train.route),
          cars: trainInfo?.cars || [],
          lastUpdated: trainInfo?.lastUpdated
        };
      });
    
    const trainsWithRatings = await Promise.all(upcomingTrains);
    
    // Sort by arrival time
    trainsWithRatings.sort((a, b) => 
      new Date(a.arrivalTime) - new Date(b.arrivalTime)
    );
    
    return NextResponse.json(trainsWithRatings, { status: 200 });
  } catch (error) {
    console.error('Error in GET /api/trains/upcoming:', error);
    return NextResponse.json({ error: 'Failed to fetch upcoming trains' }, { status: 500 });
  }
}

// Helper function to map train line to color
function getColorForLine(line) {
  const lineColors = {
    '1': 'red', '2': 'red', '3': 'red',
    '4': 'green', '5': 'green', '6': 'green', 
    '7': 'purple',
    'A': 'blue', 'C': 'blue', 'E': 'blue',
    'B': 'orange', 'D': 'orange', 'F': 'orange', 'M': 'orange',
    'G': 'green',
    'J': 'brown', 'Z': 'brown',
    'L': 'gray',
    'N': 'yellow', 'Q': 'yellow', 'R': 'yellow', 'W': 'yellow',
    'S': 'gray'
  };
  
  return lineColors[line] || 'blue';
}