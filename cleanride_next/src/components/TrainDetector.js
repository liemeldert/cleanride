import { useState, useEffect } from 'react';
import { detectUserTrain } from '../utils/trainDetection';
import { TRAIN_LINES } from '../utils/constants';

export default function TrainDetector({ onTrainDetected }) {
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState(null);
  const [possibleTrains, setPossibleTrains] = useState([]);
  const [manualEntry, setManualEntry] = useState(false);
  const [manualTrain, setManualTrain] = useState({ line: '', carNumber: '' });

  useEffect(() => {
    detectTrain();
  }, []);

  const detectTrain = async () => {
    setDetecting(true);
    setError(null);
    try {
      const result = await detectUserTrain();
      
      if (!result) {
        setError('Unable to detect your train. Please enter manually.');
        setManualEntry(true);
      } else if (result.multiplePossibilities) {
        setPossibleTrains(result.trains);
      } else {
        onTrainDetected(result);
      }
    } catch (err) {
      console.error('Error in train detection:', err);
      setError('Error detecting train. Please enter manually.');
      setManualEntry(true);
    } finally {
      setDetecting(false);
    }
  };

  const handleTrainSelection = (train) => {
    onTrainDetected(train);
    setPossibleTrains([]);
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    onTrainDetected({
      id: `${manualTrain.line}-manual-${Date.now()}`,
      line: manualTrain.line,
      carNumber: manualTrain.carNumber
    });
  };

  if (detecting) {
    return (
      <div className="flex flex-col items-center justify-center p-4">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-mta-blue"></div>
        <p className="mt-2 text-gray-600">Detecting your train...</p>
      </div>
    );
  }

  if (possibleTrains.length > 0) {
    return (
      <div className="p-4">
        <h2 className="text-lg font-semibold mb-3">Select Your Train</h2>
        <div className="space-y-2">
          {possibleTrains.map((train) => (
            <button
              key={train.id}
              onClick={() => handleTrainSelection(train)}
              className="w-full p-3 flex justify-between items-center bg-white border border-gray-300 rounded-lg"
            >
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-white bg-${TRAIN_LINES.find(t => t.id === train.route)?.color || 'mta-gray'}`}>
                {train.route}
              </span>
              <span>Heading to {train.headsign}</span>
              <span className="text-gray-500">{new Date(train.expectedArrival).toLocaleTimeString()}</span>
            </button>
          ))}
        </div>
        <div className="mt-4">
          <button 
            onClick={() => setManualEntry(true)} 
            className="w-full p-2 text-mta-blue border border-mta-blue rounded-lg"
          >
            Enter Manually
          </button>
        </div>
      </div>
    );
  }

  if (manualEntry) {
    return (
      <div className="p-4">
        <h2 className="text-lg font-semibold mb-3">Enter Your Train</h2>
        {error && <p className="text-red-500 mb-2">{error}</p>}
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Train Line
            </label>
            <select 
              value={manualTrain.line}
              onChange={(e) => setManualTrain({ ...manualTrain, line: e.target.value })}
              className="w-full p-2 border border-gray-300 rounded-lg"
              required
            >
              <option value="">Select Train Line</option>
              {TRAIN_LINES.map((line) => (
                <option key={line.id} value={line.id}>{line.id}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Car Number
            </label>
            <input 
              type="text"
              value={manualTrain.carNumber}
              onChange={(e) => setManualTrain({ ...manualTrain, carNumber: e.target.value })}
              placeholder="Enter the 4-5 digit car number"
              className="w-full p-2 border border-gray-300 rounded-lg"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              The car number can be found inside and outside the train car
            </p>
          </div>
          
          <div className="flex space-x-2">
            <button 
              type="button"
              onClick={detectTrain} 
              className="flex-1 p-2 text-mta-blue border border-mta-blue rounded-lg"
            >
              Try Auto-Detect
            </button>
            <button 
              type="submit"
              className="flex-1 p-2 bg-mta-blue text-white rounded-lg"
            >
              Submit
            </button>
          </div>
        </form>
      </div>
    );
  }

  return null;
}