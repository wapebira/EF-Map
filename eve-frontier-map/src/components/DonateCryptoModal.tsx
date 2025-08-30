import React, { useState, useEffect } from 'react';
import { Copy, Check, ExternalLink, AlertTriangle, CheckCircle, Info } from 'lucide-react';

interface DonateCryptoModalProps {
  open: boolean;
  onClose: () => void;
  address: string; // ETH/USDC receiving address (checksummed)
  ensName?: string; // Optional ENS name (e.g. lacal.eth)
}

// Truncate helper
const truncate = (addr: string) => addr.slice(0, 10) + '…' + addr.slice(-6);

// (Removed AssetCard in favor of a single unified address card per Option A.)

export const DonateCryptoModal: React.FC<DonateCryptoModalProps> = ({ open, onClose, address, ensName }) => {
  const [copied, setCopied] = useState(false);
  const [qrData, setQrData] = useState<string|null>(null);

  useEffect(()=>{
    if(!open) return;
    let cancelled = false;
    (async()=>{
      try {
        const { default: QRCode } = await import('qrcode');
        const data = await QRCode.toDataURL(address, { margin:1, scale:6, errorCorrectionLevel:'M' });
        if(!cancelled){ setQrData(data); }
      } catch {/* ignore */}
    })();
    return ()=>{ cancelled = true; };
  }, [open, address]);

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(()=> setCopied(false), 1600);
    } catch {
      alert('Copy failed; copy manually.');
    }
  };

  if(!open) return null;

  return (
    <div style={{ position:'fixed', inset:0, zIndex:4000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.7)', backdropFilter:'blur(4px)' }} />
  <div style={{ position:'relative', width:'min(720px,92%)', maxHeight:'82vh', overflowY:'auto', background:'rgba(20,20,22,0.92)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:28, padding:'28px 30px 34px', boxShadow:'0 12px 42px -6px rgba(0,0,0,0.65)', display:'flex', flexDirection:'column', gap:18, color:'#f5f6f7' }}>
        <div style={{ display:'flex', justifyContent:'flex-start', alignItems:'flex-start' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <h2 style={{ margin:0, fontSize:22, fontWeight:600 }}>Donate via Crypto{ensName?` – ${ensName}`:''}</h2>
            <p style={{ margin:0, fontSize:13, opacity:.78, lineHeight:1.5 }}>
              <strong>ETH / USDC / USDT (ERC‑20 Compatible)</strong><br/>
              Send using <strong>Ethereum Mainnet or any EVM Layer 2</strong> (Base, Arbitrum, Optimism, Polygon).<br/>
              <span style={{ color:'#ffb37a' }}>Do <strong>NOT</strong> send from Solana, Tron, or other non‑EVM chains.</span>
            </p>
            {ensName && (
              <div style={{ marginTop:4, display:'inline-flex', alignItems:'center', gap:8, background:'rgba(255,255,255,0.06)', padding:'6px 12px', borderRadius:14, fontSize:12, fontWeight:500 }}>
                <span style={{ opacity:.85 }}>ENS:</span>
                <span style={{ fontFamily:'monospace', letterSpacing:'.5px' }}>{ensName}</span>
                <button onClick={()=>{ navigator.clipboard.writeText(ensName).catch(()=>{}); setCopied(true); setTimeout(()=> setCopied(false),1600); }} style={{ background:'var(--accent)', border:'none', color:'#fff', fontSize:11, padding:'4px 10px', borderRadius:12, cursor:'pointer' }}>{copied? 'Copied':'Copy'}</button>
                <a href={`https://app.ens.domains/name/${ensName}`} target="_blank" rel="noreferrer" style={{ textDecoration:'none', color:'var(--accent)', fontSize:11 }}>View</a>
              </div>
            )}
          </div>
        </div>
        {/* Unified address / QR card */}
        <div style={{ display:'flex', gap:16, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(255,255,255,0.04)', padding:18, borderRadius:20, boxShadow:'0 4px 14px -2px rgba(0,0,0,0.55)', backdropFilter:'blur(6px)' }}>
          <div style={{ flex:'0 0 128px', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:18, background:'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.05))', position:'relative', overflow:'hidden', aspectRatio:'1 / 1' }} aria-label="Donation address QR code">
            {qrData ? (
              <img src={qrData} alt="Donation address QR" style={{ width:'100%', height:'100%', objectFit:'contain', filter:'drop-shadow(0 0 2px rgba(0,0,0,0.6))' }} />
            ) : (<span style={{ fontSize:12, opacity:.7 }}>QR</span>)}
          </div>
          <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <h3 style={{ margin:0, fontSize:16, fontWeight:600 }}>{ensName? 'Resolved Address':'Unified Address'}</h3>
              <p style={{ margin:0, fontSize:12, lineHeight:1.45, opacity:.7 }}>{ensName?`ENS ${ensName} resolves to this 0x address. Works for ETH, USDC & USDT on supported EVM networks.`:'Same 0x address works for ETH, USDC, USDT on supported EVM networks.'}</p>
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              <code style={{ flex:'1 1 240px', minWidth:160, fontFamily:'monospace', fontSize:12, padding:'9px 11px', borderRadius:12, background:'rgba(0,0,0,0.35)', border:'1px solid rgba(255,255,255,0.13)', color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{address}</code>
              <button onClick={doCopy} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'var(--accent)', border:'none', padding:'10px 16px', borderRadius:12, color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', letterSpacing:'.4px', boxShadow:'0 2px 6px rgba(0,0,0,0.4)' }}>
                {copied ? (<><Check size={16}/>Copied</>) : (<><Copy size={16}/>Copy</>)}
              </button>
              <a href={`https://etherscan.io/address/${address}`} target="_blank" rel="noreferrer" style={{ textDecoration:'none', display:'inline-flex', alignItems:'center', gap:6, background:'var(--accent)', padding:'10px 16px', borderRadius:12, color:'#fff', fontSize:12, fontWeight:600, letterSpacing:'.4px', boxShadow:'0 2px 6px rgba(0,0,0,0.4)' }}>
                <ExternalLink size={16}/>Etherscan
              </a>
            </div>
            <p style={{ margin:0, fontSize:11, lineHeight:1.4, opacity:.65 }}>Scan or copy the address, then pick ETH / USDC / USDT in your wallet on a supported network.</p>
          </div>
        </div>
        {/* Support / warning box */}
        <div style={{ marginTop:4, display:'flex', flexDirection:'column', gap:8, border:'1px solid rgba(255,255,255,0.18)', background:'linear-gradient(145deg, rgba(40,40,42,0.9), rgba(25,25,27,0.9))', padding:'14px 16px 16px', borderRadius:18, fontSize:12, lineHeight:1.5 }}>
          <div style={{ display:'flex', gap:10, alignItems:'flex-start', color:'#b3f5c2' }}>
            <CheckCircle size={18} style={{ flex:'0 0 auto', marginTop:2 }} />
            <p style={{ margin:0 }}><strong>Supported:</strong> Ethereum Mainnet, Base, Arbitrum, Optimism, Polygon.</p>
          </div>
          <div style={{ display:'flex', gap:10, alignItems:'flex-start', color:'#ffd4a3' }}>
            <AlertTriangle size={18} style={{ flex:'0 0 auto', marginTop:2 }} />
            <p style={{ margin:0 }}><strong>Do NOT</strong> send from Solana, Tron, or other non‑EVM networks — funds will be lost.</p>
          </div>
            <div style={{ display:'flex', gap:10, alignItems:'flex-start', color:'#b8d9ff' }}>
              <Info size={18} style={{ flex:'0 0 auto', marginTop:2 }} />
              <p style={{ margin:0 }}><strong>Note:</strong> USDC / USDT transfers need a tiny amount of ETH for gas on the network you choose.</p>
            </div>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'space-between', alignItems:'center', gap:12, fontSize:11, opacity:.7 }}>
          <span>{ensName? `${ensName} → `:''}Address: <span style={{ fontFamily:'monospace', fontSize:12, opacity:.9 }}>{truncate(address)}</span></span>
          <a href={`https://etherscan.io/address/${address}`} target="_blank" rel="noreferrer" style={{ color:'inherit', textDecoration:'underline', textDecorationColor:'rgba(255,255,255,0.4)' }}>Verify address on Etherscan</a>
        </div>
      </div>
    </div>
  );
};

export default DonateCryptoModal;