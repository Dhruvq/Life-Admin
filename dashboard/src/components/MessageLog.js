import React, { useEffect, useRef, useState } from 'react';
import Message from './Message';

const MessageLog = ({ messages }) => {
  const messagesEndRef = useRef(null);
  const logRef = useRef(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    if (!logRef.current) return;
    
    // On the very first batch of messages, scroll to bottom instantly.
    if (isInitialLoad && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      setIsInitialLoad(false);
      return;
    }

    // Auto-scroll for new messages only if the user hasn't scrolled up.
    if (!showScrollButton) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, showScrollButton, isInitialLoad]);

  const handleScroll = () => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    
    // Show scroll button if user scrolls up past 50px from the bottom
    const isCloseToBottom = scrollHeight - scrollTop - clientHeight < 50;
    setShowScrollButton(!isCloseToBottom);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="message-log-container">
      <div className="message-log" ref={logRef} onScroll={handleScroll}>
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {showScrollButton && (
        <button className="scroll-bottom-btn" onClick={scrollToBottom}>
          ↓ Scroll to recent
        </button>
      )}
    </div>
  );
};

export default MessageLog;