import { ReactNode } from 'react';
import './PageLayout.css';

interface PageLayoutProps {
  title: string;
  children: ReactNode;
}

export default function PageLayout({ title, children }: PageLayoutProps) {
  return (
    <main className="page-layout" id="main-content">
      <div className="page-layout__container">
        <div className="page-layout__header">
          <h1 className="page-layout__title">{title}</h1>
        </div>
        <div className="page-layout__body">
          {children}
        </div>
      </div>
    </main>
  );
}
