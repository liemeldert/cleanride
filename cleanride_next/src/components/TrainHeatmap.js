import { useEffect, useRef } from 'react';

export default function TrainHeatmap({ trainData, reports }) {
  const containerRef = useRef(null);
  const heatmapRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !reports || reports.length === 0) return;
    
    // Create heatmap instance
    const heatmapInstance = window.h337.create({
      container: containerRef.current,
      radius: 30,
      maxOpacity: 0.9,
      minOpacity: 0.05,
      blur: 0.75,
    });
    
    heatmapRef.current = heatmapInstance;
    
    // Update heatmap data
    updateHeatmap();
    
    return () => {
      // Cleanup if needed
    };
  }, [containerRef.current]);
  
  useEffect(() => {
    if (heatmapRef.current && reports) {
      updateHeatmap();
    }
  }, [reports]);
  
  const updateHeatmap = () => {
    if (!containerRef.current || !heatmapRef.current || !reports) return;
    
    const { width, height } = containerRef.current.getBoundingClientRect();
    
    // Normalize car positions across the width
    const carCount = trainData.cars.length;
    const carWidth = width / carCount;
    
    // Generate heatmap data points
    const points = [];
    
    reports.forEach(report => {
      // Find car index
      const carIndex = trainData.cars.findIndex(car => car.carNumber === report.carNumber);
      if (carIndex === -1) return;
      
      // Calculate x position (center of car)
      const x = (carIndex * carWidth) + (carWidth / 2);
      
      // Calculate y position (random variation within car)
      const y = height / 2 + (Math.random() * 20 - 10);
      
      // Calculate value based on severity and recency
      const age = Date.now() - new Date(report.createdAt).getTime();
      const ageInHours = age / (1000 * 60 * 60);
      const recencyFactor = Math.max(0, 1 - (ageInHours / 24)); // Decay over 24 hours
      
      // Higher severity and more recent = higher value
      const value = report.severity * 20 * recencyFactor;
      
      points.push({
        x: Math.round(x),
        y: Math.round(y),
        value,
        // For safety concerns, make them more prominent
        radius: report.isUrgent ? 40 : 30
      });
    });
    
    heatmapRef.current.setData({
      max: 100,
      data: points
    });
  };

  return (
    <div className="relative w-full my-4" style={{ height: '120px' }}>
      <div ref={containerRef} className="absolute inset-0 bg-gray-100 rounded-lg"></div>
      
      {/* Train car labels overlay */}
      <div className="absolute inset-0 flex items-center">
        {trainData.cars.map((car, index) => (
          <div key={index} className="flex-1 flex flex-col items-center justify-center text-xs text-gray-700">
            <div className="bg-white bg-opacity-75 px-2 py-1 rounded">
              {car.carNumber}
            </div>
            {car.reports?.length > 0 && (
              <div className="mt-1 flex items-center">
                <span className="bg-red-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs">
                  {car.reports.length}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
