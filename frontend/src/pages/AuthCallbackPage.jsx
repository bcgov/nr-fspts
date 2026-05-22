import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { InlineLoading } from '@carbon/react';
import { completeLogin } from '../auth/auth';

export default function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const ranRef = useRef(false);

  useEffect(() => {
    // Authorization codes are single-use; guard against StrictMode double-invoke.
    if (ranRef.current) return;
    ranRef.current = true;

    const code = params.get('code');
    const returnedState = params.get('state');
    const errParam = params.get('error');

    if (errParam) {
      setError(`${errParam}: ${params.get('error_description') ?? ''}`.trim());
      return;
    }
    if (!code) {
      setError('Missing authorization code in callback URL.');
      return;
    }

    completeLogin({ code, returnedState })
      .then(() => navigate('/welcome', { replace: true }))
      .catch((e) => setError(e.message));
  }, [params, navigate]);

  if (error) {
    return (
      <main className="login-page" id="main-content">
        <div className="login-card">
          <h1 className="login-card__title">Sign-in failed</h1>
          <p className="login-card__subtitle">{error}</p>
          <a href="/" className="login-card__btn">Back to login</a>
        </div>
      </main>
    );
  }
  return (
    <main className="login-page" id="main-content">
      <div className="login-card">
        <InlineLoading description="Signing you in…" status="active" />
      </div>
    </main>
  );
}
