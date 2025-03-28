import { useState } from 'react';
import TrainHeatmap from './TrainHeatmap';

export default function TrainMap({ train, reports }) {
  const [expanded, setExpanded] = useState(false);
  
  // Filter urgent reports
  const urgentReports = reports.filter(report => report.isUrgent);
  
  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-lg font-semibold">
          Train {train.line} Status
        </h2>
        <button 
          onClick={() => setExpanded(!expanded)}
          className="text-mta-blue"
        >
          {expanded ? 'Less' : 'More'} Info
        </button>
      </div>
      
      <div className="flex items-center mb-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white bg-mta-${train.color || 'blue'}`}>
          {train.line}
        </div>
        <div className="ml-2">
          <div className="text-sm">Last updated: {new Date(train.lastUpdated).toLocaleTimeString()}</div>
          <div className="text-sm flex items-center">
            Current rating: 
            <div className="flex ml-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <svg 
                  key={star}
                  xmlns="http://www.w3.org/2000/svg" 
                  viewBox="0 0 24 24"
                  className={`w-4 h-4 ${star <= train.currentRating ? 'text-yellow-500' : 'text-gray-300'}`}
                  fill="currentColor"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {urgentReports.length > 0 && (
        <div className="bg-red-100 border-l-4 border-red-500 p-2 mb-3">
          <p className="text-sm font-medium text-red-700">
            {urgentReports.length} urgent issue(s) reported
          </p>
        </div>
      )}
      
      <TrainHeatmap trainData={train} reports={reports} />
      
      {expanded && (
        <div className="mt-3 border-t pt-3">
          <h3 className="text-sm font-medium mb-2">Recent Reports</h3>
          
          {reports.length === 0 ? (
            <p className="text-sm text-gray-500">No reports for this train.</p>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {reports.slice(0, 5).map((report) => (
                <div key={report.id} className="text-sm border-l-2 pl-2 border-gray-300">
                  <div className="flex justify-between">
                    <span className="font-medium">Car {report.carNumber}</span>
                    <span className="text-gray-500 text-xs">
                      {new Date(report.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span 
                      className={`w-2 h-2 rounded-full mr-1 ${
                        report.isUrgent ? 'bg-red-500' : 'bg-yellow-500'
                      }`}
                    ></span>
                    <span>{report.reportType}</span>
                  </div>
                  {report.description && (
                    <p className="text-gray-600 text-xs mt-1">{report.description}</p>
                  )}
                </div>
              ))}
              
              {reports.length > 5 && (
                <p className="text-xs text-center text-mta-blue">
                  + {reports.length - 5} more reports
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
