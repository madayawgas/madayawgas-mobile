import React from 'react';
import ProfileScreen from '../../../screens/shared/ProfileScreen';

const DRIVER_TABS = [
  { id: 'dashboard', label: 'Cabin', iconName: 'speedometer-outline', activeIconName: 'speedometer' },
  { id: 'maintenance', label: 'Vehicle', iconName: 'construct-outline', activeIconName: 'construct' },
  { id: 'profile', label: 'Profile', iconName: 'person-circle-outline', activeIconName: 'person-circle' },
];

const DriverProfileScreen = (props) => {
  return <ProfileScreen {...props} tabs={DRIVER_TABS} />;
};

export default DriverProfileScreen;
