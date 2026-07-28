import onboardingBg from '../../assets/onboardingbg.png';

function Auth() {
  return (
    <div
      className="h-full min-h-screen bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${onboardingBg})` }}
    />
  );
}

export default Auth;
