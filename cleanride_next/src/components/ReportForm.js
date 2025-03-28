import { useState } from 'react';
// import { useSession } from 'next-auth/react';
import { ISSUE_TYPES } from '../utils/constants';
import IssueButton from './IssueButton';

export default function ReportForm({ train, carNumber, onSubmit }) {
  // const { data: session } = useSession();
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState(3);
  const [isUrgent, setIsUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!selectedIssue) {
      setError('Please select an issue type');
      return;
    }
    
    setSubmitting(true);
    setError(null);
    
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          },
          (error) => {
            console.warn('Geolocation error:', error);
            resolve(null); // Continue without location
          }
        );
      });
      
      const reportData = {
        trainId: train.id,
        line: train.line,
        carNumber,
        reportType: selectedIssue.id,
        description,
        severity,
        isUrgent: isUrgent || !!selectedIssue.urgent,
        location: position,
        // userId: session?.user?.id,
      };
      
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reportData),
      });
      
      if (!response.ok) {
        throw new Error('Failed to submit report');
      }
      
      setSuccess(true);
      setSelectedIssue(null);
      setDescription('');
      setSeverity(3);
      setIsUrgent(false);
      
      // Call parent component's onSubmit callback
      onSubmit(reportData);
      
      // Reset success message after 3 seconds
      setTimeout(() => {
        setSuccess(false);
      }, 3000);
      
    } catch (err) {
      console.error('Error submitting report:', err);
      setError(err.message || 'Error submitting report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 bg-gray-50 rounded-lg">
      <h2 className="text-lg font-semibold mb-3">Report an Issue</h2>
      {success ? (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
          <p>Thank you! Your report has been submitted.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              <p>{error}</p>
            </div>
          )}
          
          <div className="mb-4">
            <p className="text-sm text-gray-600 mb-2">Train: {train.line} • Car: {carNumber}</p>
            <div className="grid grid-cols-2 gap-2">
              {ISSUE_TYPES.map((issue) => (
                <IssueButton
                  key={issue.id}
                  issue={issue}
                  onSelect={setSelectedIssue}
                  isSelected={selectedIssue?.id === issue.id}
                />
              ))}
            </div>
          </div>
          
          {selectedIssue && (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description (Optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg"
                  rows="2"
                  placeholder="Add details about the issue..."
                ></textarea>
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Severity
                </label>
                <div className="flex items-center">
                  <span className="text-sm text-gray-500 mr-2">Minor</span>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={severity}
                    onChange={(e) => setSeverity(parseInt(e.target.value))}
                    className="flex-grow"
                  />
                  <span className="text-sm text-gray-500 ml-2">Severe</span>
                </div>
              </div>
              
              {!selectedIssue.urgent && (
                <div className="mb-4">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={isUrgent}
                      onChange={(e) => setIsUrgent(e.target.checked)}
                      className="h-4 w-4 text-mta-blue"
                    />
                    <span className="ml-2 text-sm text-gray-700">
                      Mark as urgent (safety concern)
                    </span>
                  </label>
                </div>
              )}
              
              <button
                type="submit"
                disabled={submitting}
                className={`w-full p-3 rounded-lg ${
                  submitting 
                    ? 'bg-gray-300 text-gray-700'
                    : selectedIssue.color + ' text-white'
                }`}
              >
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </>
          )}
        </form>
      )}
    </div>
  );
}
