import React from 'react';

const Message = ({ message }) => {
  const { text, sender, timestamp } = message;
  const isUser = sender === 'user';
  const wrapperClass = isUser ? 'user-wrapper' : 'agent-wrapper';
  const messageClass = isUser ? 'user-message' : 'agent-message';

  return (
    <div className={`message-wrapper ${wrapperClass}`}>
      <div className="message-sender">
        <span className={`sender-dot ${isUser ? 'user-dot' : 'agent-dot'}`}></span>
        {isUser ? 'User' : 'AI Agent'}
      </div>
      <div className={`message ${messageClass}`}>
        {text}
      </div>
      <span className="timestamp">
        {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
};

export default Message;
