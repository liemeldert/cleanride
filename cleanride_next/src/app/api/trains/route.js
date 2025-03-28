import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import Train from '@/models/Train';

export async function GET(request) {
  try {
    await connectToDatabase();
    
    // Get query parameters
    const { searchParams } = new URL(request.url);
    const line = searchParams.get('line');
    const trainId = searchParams.get('id');
    
    // Build query
    const query = {};
    if (line) query.line = line;
    if (trainId) query.trainId = trainId;
    
    // Get trains
    const trains = await Train.find(query).sort({ lastUpdated: -1 });
    
    return NextResponse.json(trains, { status: 200 });
  } catch (error) {
    console.error('Error in GET /api/trains:', error);
    return NextResponse.json({ error: 'Failed to fetch trains' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await connectToDatabase();
    
    const data = await request.json();
    
    if (!data.trainId || !data.line || !data.route) {
      return NextResponse.json(
        { error: 'Missing required fields' }, 
        { status: 400 }
      );
    }
    
    // Check if train already exists
    let train = await Train.findOne({ trainId: data.trainId });
    
    if (train) {
      // Update existing train
      Object.assign(train, {
        ...data,
        lastUpdated: new Date()
      });
      await train.save();
    } else {
      // Create new train
      train = new Train({
        ...data,
        lastUpdated: new Date()
      });
      await train.save();
    }
    
    return NextResponse.json(train, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/trains:', error);
    return NextResponse.json({ error: 'Failed to create/update train' }, { status: 500 });
  }
}