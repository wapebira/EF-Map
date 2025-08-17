import { useState, useEffect, useRef } from 'react';
import './AutoCompleteInput.css';

interface AutoCompleteInputProps {
  value: string;
  onChange: (newValue: string) => void;
  onSelect: (selectedValue: string) => void;
  dataSource: string[];
  placeholder?: string;
}

const AutoCompleteInput = ({ value, onChange, onSelect, dataSource, placeholder }: AutoCompleteInputProps) => {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSuggestionsVisible, setIsSuggestionsVisible] = useState(false);
  const componentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (componentRef.current && !componentRef.current.contains(event.target as Node)) {
        setIsSuggestionsVisible(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    if (newValue.length >= 3) {
      const filteredSuggestions = dataSource.filter(item =>
        item.toLowerCase().startsWith(newValue.toLowerCase())
      );
      setSuggestions(filteredSuggestions);
      setIsSuggestionsVisible(true);
    } else {
      setSuggestions([]);
      setIsSuggestionsVisible(false);
    }
  };

  const handleSelect = (selectedValue: string) => {
    onSelect(selectedValue);
    setIsSuggestionsVisible(false);
  };

  return (
    <div className="autocomplete-container" ref={componentRef}>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        style={{ padding: '5px', width: '100%' }}
      />
      {isSuggestionsVisible && suggestions.length > 0 && (
        <ul className="suggestions-list">
          {suggestions.map((item, index) => (
            <li key={index} onClick={() => handleSelect(item)}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AutoCompleteInput;
