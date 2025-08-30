import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  const [dropdownPos, setDropdownPos] = useState<{left:number; top:number; width:number}>({ left:0, top:0, width:0 });
  const componentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // If clicking inside the suggestions portal (marked with data-ac-suggestions), don't treat as outside.
      if (target.closest('[data-ac-suggestions]')) return;
      if (componentRef.current && !componentRef.current.contains(target)) {
        setIsSuggestionsVisible(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => { document.removeEventListener('mousedown', handleClickOutside); };
  }, []);

  const recalcPosition = () => {
    if (!componentRef.current) return;
    const input = componentRef.current.querySelector('input');
    if (!input) return;
    const rect = (input as HTMLInputElement).getBoundingClientRect();
    setDropdownPos({
      left: rect.left + window.scrollX,
      top: rect.bottom + window.scrollY,
      width: rect.width
    });
  };

  useEffect(()=>{
    if (isSuggestionsVisible) recalcPosition();
  },[isSuggestionsVisible,value]);

  useEffect(()=>{
    const onWin = () => { if(isSuggestionsVisible) recalcPosition(); };
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, true);
    return ()=> { window.removeEventListener('resize', onWin); window.removeEventListener('scroll', onWin, true); };
  },[isSuggestionsVisible]);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if(e.key === 'Enter') {
      // Accept typed value if it matches a system exactly (case-insensitive)
      const match = dataSource.find(item => item.toLowerCase() === value.toLowerCase());
      if(match) {
        onSelect(match);
        setIsSuggestionsVisible(false);
      }
    }
  };

  const dropdown = (isSuggestionsVisible && suggestions.length > 0) ? createPortal(
      <ul className="suggestions-list" data-ac-suggestions style={{ position:'fixed', left:dropdownPos.left, top:dropdownPos.top, width:dropdownPos.width, zIndex:3000 }}>
        {suggestions.map((item, index) => (
          <li
            key={index}
            data-ac-suggestion-item
            onMouseDown={(e)=> { // use mousedown so it fires before outside handler removes list
              e.preventDefault();
              handleSelect(item);
            }}
          >
            {item}
          </li>
        ))}
      </ul>, document.body
    ) : null;

  return (
    <div className="autocomplete-container" ref={componentRef}>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="p2p-input"
        onFocus={()=> { if(value.length>=3 && suggestions.length>0){ setIsSuggestionsVisible(true); recalcPosition(); }}}
      />
      {dropdown}
    </div>
  );
};

export default AutoCompleteInput;
