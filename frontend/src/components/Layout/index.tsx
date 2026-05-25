import { Content, HeaderContainer } from '@carbon/react';
import type { FC, ReactNode } from 'react';
import { LayoutProvider } from '@/context/layout/LayoutProvider';
import { LayoutHeader } from './LayoutHeader';
import './Layout.css';

const Layout: FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <LayoutProvider>
      <HeaderContainer render={LayoutHeader} />
      <Content>{children}</Content>
    </LayoutProvider>
  );
};

export default Layout;
