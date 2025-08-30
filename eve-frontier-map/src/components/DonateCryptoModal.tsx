import React, { useState, useEffect } from 'react';
import { Copy, Check, ExternalLink, AlertTriangle } from 'lucide-react';

interface DonateCryptoModalProps {
  open: boolean;
  onClose: () => void;
  address: string; // ETH/USDC receiving address (checksummed)
}

// Truncate helper
const truncate = (addr: string) => addr.slice(0, 10) + '…' + addr.slice(-6);

interface AssetCardProps {
  title: string;
  subtitle: string;
  etherscanHref: string;
  onCopy: () => void;
  copied: boolean;
  qrData?: string | null; // data URL for QR
  qrLabel: string;
}

const AssetCard: React.FC<AssetCardProps> = ({ title, subtitle, etherscanHref, onCopy, copied, qrData, qrLabel }) => {
  return (
    <div style={{ display:'flex', gap:16, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(255,255,255,0.04)', padding:16, borderRadius:18, boxShadow:'0 4px 14px -2px rgba(0,0,0,0.55)', backdropFilter:'blur(6px)' }}>
      <div style={{ flex:'0 0 112px', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:16, background:'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.05))', position:'relative', overflow:'hidden', aspectRatio:'1 / 1' }} aria-label={`${qrLabel} QR code`}>
        {qrData ? (
          <img src={qrData} alt={`${qrLabel} QR`} style={{ width:'100%', height:'100%', objectFit:'contain', filter:'drop-shadow(0 0 2px rgba(0,0,0,0.6))' }} />
        ) : (
          <span style={{ fontSize:12, opacity:.7 }}>QR</span>
        )}
      </div>
      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <h3 style={{ margin:0, fontSize:15, fontWeight:600 }}>{title}</h3>
          <span style={{ fontSize:11, fontWeight:500, padding:'4px 8px', borderRadius:999, background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.18)', letterSpacing:.25 }}>{subtitle}</span>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <code style={{ flex:'1 1 220px', minWidth:140, fontFamily:'monospace', fontSize:12, padding:'8px 10px', borderRadius:10, background:'rgba(0,0,0,0.35)', border:'1px solid rgba(255,255,255,0.13)', color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{etherscanHref.includes('token') ? etherscanHref.split('=')[1] : etherscanHref.split('/').pop()}</code>
          <button onClick={onCopy} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'var(--accent)', border:'none', padding:'8px 14px', borderRadius:10, color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', letterSpacing:'.4px', boxShadow:'0 2px 6px rgba(0,0,0,0.4)' }}>
            {copied ? (<><Check size={16}/>Copied</>) : (<><Copy size={16}/>Copy</>)}
          </button>
          <a href={etherscanHref} target="_blank" rel="noreferrer" style={{ textDecoration:'none', display:'inline-flex', alignItems:'center', gap:6, background:'var(--accent)', padding:'8px 14px', borderRadius:10, color:'#fff', fontSize:12, fontWeight:600, letterSpacing:'.4px', boxShadow:'0 2px 6px rgba(0,0,0,0.4)' }}>
            <ExternalLink size={16}/>View on Etherscan
          </a>
        </div>
        <p style={{ margin:0, fontSize:11, lineHeight:1.4, opacity:.65 }}>Scan the QR or copy the address then choose the asset in your wallet.</p>
      </div>
    </div>
  );
};

export const DonateCryptoModal: React.FC<DonateCryptoModalProps> = ({ open, onClose, address }) => {
  const [copied, setCopied] = useState<{ eth:boolean; usdc:boolean }>({ eth:false, usdc:false });
  const [qrEth, setQrEth] = useState<string|null>(null);
  const [qrUsdc, setQrUsdc] = useState<string|null>(null);

  useEffect(()=>{
    if(!open) return;
    let cancelled = false;
    (async()=>{
      try {
        const { default: QRCode } = await import('qrcode');
        const ethData = await QRCode.toDataURL(address, { margin:1, scale:6, errorCorrectionLevel:'M' });
        const usdcData = ethData; // same underlying address
        if(!cancelled){ setQrEth(ethData); setQrUsdc(usdcData); }
      } catch {/* ignore */}
    })();
    return ()=>{ cancelled = true; };
  }, [open, address]);

  const doCopy = async (key: 'eth'|'usdc') => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(c=> ({ ...c, [key]: true }));
      setTimeout(()=> setCopied(c=> ({ ...c, [key]: false })), 1600);
    } catch {
      alert('Copy failed; copy manually.');
    }
  };

  if(!open) return null;

  return (
    <div style={{ position:'fixed', inset:0, zIndex:4000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.7)', backdropFilter:'blur(4px)' }} />
      <div style={{ position:'relative', width:'min(720px,92%)', maxHeight:'82vh', overflowY:'auto', background:'rgba(20,20,22,0.92)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:28, padding:'28px 30px 34px', boxShadow:'0 12px 42px -6px rgba(0,0,0,0.65)', display:'flex', flexDirection:'column', gap:18 }}>
        <div style={{ display:'flex', justifyContent:'flex-start', alignItems:'flex-start' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <h2 style={{ margin:0, fontSize:22, fontWeight:600 }}>Donate via Crypto</h2>
            <p style={{ margin:0, fontSize:13, opacity:.78, lineHeight:1.5 }}>Choose an asset on <strong>Ethereum Mainnet (Chain ID 1)</strong>. QR codes are provided for convenience. Click outside this window to close.</p>
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <AssetCard
            title="ETH (Native)"
            subtitle="Ethereum Mainnet — Chain ID 1"
            etherscanHref={`https://etherscan.io/address/${address}`}
            onCopy={()=> doCopy('eth')}
            copied={copied.eth}
            qrData={qrEth}
            qrLabel="ETH"
          />
          <AssetCard
            title="USDC (ERC‑20 Token)"
            subtitle="Ethereum Mainnet — Chain ID 1"
            etherscanHref={`https://etherscan.io/token/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48?a=${address}`}
            onCopy={()=> doCopy('usdc')}
            copied={copied.usdc}
            qrData={qrUsdc}
            qrLabel="USDC"
          />
        </div>
        <div style={{ marginTop:8, display:'flex', gap:10, border:'1px solid rgba(255,200,120,0.35)', background:'rgba(255,200,120,0.12)', padding:'12px 14px', borderRadius:16, fontSize:12, lineHeight:1.45, color:'#ffdca8' }}>
          <AlertTriangle size={18} style={{ flex:'0 0 auto', marginTop:2 }} />
          <p style={{ margin:0 }}>
            Send <strong>USDC only on Ethereum Mainnet</strong>. Do not send from Polygon, Arbitrum, TRON, or Solana. Using the wrong network can result in loss of funds. Sending USDC requires a small amount of ETH for gas.
          </p>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'space-between', alignItems:'center', gap:12, fontSize:11, opacity:.7 }}>
          <span>Address: <span style={{ fontFamily:'monospace', fontSize:12, opacity:.9 }}>{truncate(address)}</span></span>
          <a href={`https://etherscan.io/address/${address}`} target="_blank" rel="noreferrer" style={{ color:'inherit', textDecoration:'underline', textDecorationColor:'rgba(255,255,255,0.4)' }}>Verify address on Etherscan</a>
        </div>
      </div>
    </div>
  );
};

export default DonateCryptoModal;