import { useState, useEffect } from 'react';
// import { useSession } from 'next-auth/react';
import TrainDetector from './TrainDetector';
import ReportForm from './ReportForm';
import TrainMap from './TrainMap';

export default function TrainView() {
  // const { data: session } = useSession();
  const [currentStep, setCurrentStep] = useState('detect');
  const [selectedTrain, setSelectedTrain] = useState(null);
  const [selectedCar, setSelectedCar] = useState('');
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const handleTrainDetected = async (train) => {
    setSelectedTrain(train);
    
    // If car number is provided, pre-select it
    if (train.carNumber) {
      setSelectedCar(train.carNumber);
      setCurrentStep('report');
    } else {
      setCurrentStep('selectCar');
    }
    
    // Load existing reports for this train
    try {
      setLoading(true);
      const response = await fetch(`/api/reports?trainId=${train.id}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch train reports');
      }
      
      const reportData = await response.json();
      setReports(reportData);
      
    } catch (err) {
      console.error('Error fetching reports:', err);
      setError('Unable to load existing reports');
    } finally {
      setLoading(false);
    }
  };
  
  const handleCarSubmit = (e) => {
    e.preventDefault();
    setCurrentStep('report');
  };
  
  const handleReportSubmit = (reportData) => {
    // Add the new report to the list
    setReports([...reports, {
      ...reportData,
      createdAt: new Date().toISOString(),
      id: `temp-${Date.now()}`
    }]);
  };
  
  const renderStep = () => {
    switch (currentStep) {
      case 'detect':
        return <TrainDetector onTrainDetected={handleTrainDetected} />;
        
      case 'selectCar':
        return (
          <div className="p-4">
            <h2 className="text-lg font-semibold mb-3">Enter Car Number</h2>
            <form onSubmit={handleCarSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Car Number
                </label>
                <input 
                  type="text"
                  value={selectedCar}
                  onChange={(e) => setSelectedCar(e.target.value)}
                  placeholder="Enter the 4-5 digit car number"
                  className="w-full p-2 border border-gray-300 rounded-lg"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  The car number can be found inside and outside the train car
                </p>
              </div>
              
              <button 
                type="submit"
                className="w-full p-3 bg-mta-blue text-white rounded-lg"
              >
                Continue
              </button>
            </form>
          </div>
        );
        
      case 'report':
        return (
          <div className="p-4">
            {selectedTrain && (
              <>
                <TrainMap 
                  train={{
                    ...selectedTrain,
                    cars: Array.from({ length: 10 }, (_, i) => ({
                      carNumber: String(i + 1).padStart(4, '0'),
                      reports: reports.filter(r => r.carNumber === String(i + 1).padStart(4, '0'))
                    }))
                  }}
                  reports={reports}
                />
                
                <ReportForm 
                  train={selectedTrain}
                  carNumber={selectedCar}
                  onSubmit={handleReportSubmit}
                />
                
                <div className="mt-4">
                  <button
                    onClick={() => setCurrentStep('detect')}
                    className="w-full p-3 border border-mta-blue text-mta-blue rounded-lg"
                  >
                    Change Train
                  </button>
                </div>
              </>
            )}
          </div>
        );
        
      default:
        return <div>Something went wrong</div>;
    }
  };
  
  return (
    <div className="pb-16">
      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded-lg">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-mta-blue mx-auto"></div>
            <p className="mt-2">Loading...</p>
          </div>
        </div>
      )}
      
      {error && (
        <div className="p-4">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            <p>{error}</p>
          </div>
        </div>
      )}
      
      {renderStep()}
    </div>
  );
}