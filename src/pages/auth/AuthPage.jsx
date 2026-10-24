import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link, Navigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { sdk } from '@/services/sdk';
import { setUser } from '@/store/userSlice';
import { AUTH_PROFILES, GENERIC_AUTH } from '@/config/app.config';
import ApperIcon from '@/components/ApperIcon';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import AuthLayout from './AuthLayout';

export default function AuthPage({ mode }) {
  if (mode === 'signup') {
    return <Navigate to="/login" replace />;
  }

  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { profile: profileParam } = useParams();

  const hasProfiles = AUTH_PROFILES?.length > 0;
  const matchedProfile = hasProfiles && profileParam
    ? AUTH_PROFILES.find((p) => p.key === profileParam)
    : null;

  const redirectAfterAuth = matchedProfile?.redirectAfterAuth ?? GENERIC_AUTH.redirectAfterAuth;
  const authPage = matchedProfile?.authPage;
  const title = authPage?.loginTitle ?? GENERIC_AUTH.loginTitle;
  const description = authPage?.loginDescription ?? GENERIC_AUTH.loginDescription;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const connectionFailed = sdk.session.initFailed;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const profileSlug = matchedProfile?.profileSlug;
      const result = await sdk.session.login({
        email,
        password,
        ...(profileSlug && { profileSlug }),
      });

      if (result.ok) {
        dispatch(setUser(result.value));
        const params = new URLSearchParams(window.location.search);
        const redirectPath = params.get('redirect');
        navigate(redirectPath || redirectAfterAuth, { replace: true });
      } else {
        setError(result.error?.message || 'Invalid email or password.');
      }
    } catch (err) {
      setError(err?.message || 'Unexpected authentication error.');
    } finally {
      setLoading(false);
    }
  };

  if (connectionFailed) {
    const handleRetry = async () => {
      setError(null);
      setLoading(true);
      await sdk.session.retry();
      setLoading(false);
      if (!sdk.session.initFailed) {
        window.location.reload();
      } else {
        setError('Still unable to connect. Check your network and try again.');
      }
    };

    return (
      <AuthLayout title="Unable to connect" icon="WifiOff">
        <div className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">
            Authentication service is unreachable. This may be due to a network issue or CORS configuration.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button variant="outline" onClick={handleRetry} disabled={loading} className="w-full">
            {loading ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={title} description={description}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            className="h-9"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-xs text-primary hover:text-primary/80 transition-colors">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-9 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <ApperIcon name={showPassword ? 'EyeOff' : 'Eye'} size={16} />
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive flex items-start gap-2">
            <ApperIcon name="AlertCircle" size={15} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="pt-2">
          <Button type="submit" disabled={loading} className="w-full h-9">
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>

      <div className="mt-8 border-t border-border/50 pt-4 text-center">
        <p className="text-xs text-muted-foreground">
          Authorized foundry personnel only.
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground/75">
          User accounts and role assignments are managed by the Foundry Administrator via Supabase.
        </p>
      </div>
    </AuthLayout>
  );
}