import { NextResponse } from 'next/server';
import connectToDatabase from '../../../lib/mongodb';
import Report from '../../../models/Report';
import Train from '../../../models/Train';
import User from '../../../models/User';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';

export async function GET(request) {
  try {
    await connectToDatabase();
    
    // Get query parameters
    const { searchParams } = new URL(request.url);
    const trainId = searchParams.get('trainId');
    const carNumber = searchParams.get('carNumber');
    const isUrgent = searchParams.get('isUrgent');
    
    // Build query
    const query = {};
    if (trainId) query.trainId = trainId;
    if (carNumber) query.carNumber = carNumber;
    if (isUrgent === 'true') query.isUrgent = true;
    
    // Get reports
    const reports = await Report.find(query)
      .sort({ createdAt: -1 })
      .limit(100);
    
    return NextResponse.json(reports, { status: 200 });
  } catch (error) {
    console.error('Error in GET /api/reports:', error);
    return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await connectToDatabase();
    
    const session = await getServerSession(authOptions);
    const data = await request.json();
    
    if (!data.trainId || !data.carNumber || !data.reportType) {
      return NextResponse.json(
        { error: 'Missing required fields' }, 
        { status: 400 }
      );
    }
    
    // Create new report
    const newReport = new Report({
      ...data,
      userId: session?.user?.id || null,
    });
    
    const savedReport = await newReport.save();
    
    // Update train data
    let train = await Train.findOne({ trainId: data.trainId });
    
    if (!train) {
      // Create train if it doesn't exist
      train = new Train({
        trainId: data.trainId,
        line: data.line,
        route: data.line,
        cars: [{ carNumber: data.carNumber, reports: [savedReport._id] }],
        lastUpdated: new Date()
      });
    } else {
      // Update existing train
      let carExists = false;
      
      for (const car of train.cars) {
        if (car.carNumber === data.carNumber) {
          car.reports.push(savedReport._id);
          carExists = true;
          break;
        }
      }
      
      if (!carExists) {
        train.cars.push({
          carNumber: data.carNumber,
          reports: [savedReport._id]
        });
      }
      
      // Update train rating based on recent reports
      const recentReports = await Report.find({
        trainId: data.trainId,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      });
      
      if (recentReports.length > 0) {
        // Calculate average severity (reversed, since 5 is best in our rating)
        const avgSeverity = recentReports.reduce((acc, report) => 
          acc + report.severity, 0) / recentReports.length;
        
        // Convert to 1-5 scale where 5 is best
        train.currentRating = Math.max(1, 6 - avgSeverity);
      }
      
      train.lastUpdated = new Date();
    }
    
    await train.save();
    
    // If user is logged in, associate report with user
    if (session?.user?.id) {
      await User.findByIdAndUpdate(
        session.user.id,
        { $push: { reports: savedReport._id } }
      );
    }
    
    return NextResponse.json(savedReport, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/reports:', error);
    return NextResponse.json({ error: 'Failed to create report' }, { status: 500 });
  }
}
