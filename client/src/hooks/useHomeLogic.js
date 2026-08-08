import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';

export const useHomeLogic = () => {
  const navigate = useNavigate();
  const [isLoaded, setIsLoaded] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);


  // SET INITIAL LOADED STATE
  useEffect(() => {
    setIsLoaded(true);
  }, []);


  // HANDLE SCROLL EVENT TO UPDATE NAVBAR VISIBILITY
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 50) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);


  // NAVIGATE TO CHECKING PAGE
  const handleStart = () => {
    navigate('/checking');
  };


  return {
    isLoaded,
    isScrolled,
    handleStart
  };
};
