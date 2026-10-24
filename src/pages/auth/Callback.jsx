import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sdk } from '@/services/sdk';
import ApperIcon from '@/components/ApperIcon';

export default function Callback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('Verifying your session…');

  useEffect(() => {
    let active = true;

    const resolveAuth = async () => {
      try {
        if (sdk.session.isReady) {
          await sdk.session.isReady();
        }

        // Brief delay to allow token parse from hash fragment if present
        setTimeout(() => {
          if (!active) return;
          const user = sdk.session.user();
          if (user) {
            setStatus('Verification complete! Redirecting to foundry operations…');
            navigate('/', { replace: true });
          } else {
            navigate('/login', { replace: true });
          }
        }, 600);
      } catch {
        if (active) navigate('/login', { replace: true });
      }
    };

    resolveAuth();
    return () => { active = false; };
  }, [navigate]);

  return (
    <div className="min-h-svh flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 p-6 text-center">
        <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
          <ApperIcon name="Loader2" size={20} className="animate-spin text-primary" />
        </div>
        <p className="text-sm font-medium text-foreground">{status}</p>
        <p className="text-xs text-muted-foreground">Please wait while Supabase validates your credentials.</p>
      </div>
    </div>
  );
}

