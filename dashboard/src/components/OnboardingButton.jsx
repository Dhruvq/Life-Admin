import React, { useState } from 'react';

export default function OnboardingButton() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [status, setStatus] = useState('');

  const handleSendWelcomeText = async () => {
    if (!phoneNumber) {
      setStatus('Please enter a phone number.');
      return;
    }

    setStatus('Sending...');

    try {
      // Point this URL to your running Life-Admin backend
      const response = await fetch('http://localhost:3001/api/send-welcome', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumber }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Failed to send text');
      
      setStatus('✅ Initial text sent successfully!');
      setPhoneNumber(''); // clear input
    } catch (error) {
      setStatus(`❌ Error: ${error.message}`);
    }
  };

  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px', maxWidth: '400px' }}>
      <h3>Send Initial Welcome Text</h3>
      <input 
        type="tel" 
        placeholder="+1 (555) 555-5555" 
        value={phoneNumber}
        onChange={(e) => setPhoneNumber(e.target.value)}
        style={{ padding: '8px', width: '100%', marginBottom: '10px' }}
      />
      <button onClick={handleSendWelcomeText} style={{ padding: '8px 16px', cursor: 'pointer' }}>
        Send Welcome Text
      </button>
      {status && <p style={{ marginTop: '10px', fontSize: '14px' }}>{status}</p>}
    </div>
  );
}