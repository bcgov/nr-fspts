import {
  Accordion,
  AccordionItem,
  Button,
  CodeSnippet,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
} from '@carbon/react';
import { type FC } from 'react';

/**
 * Collapsed-by-default reference for the Boundary field: one worked example
 * per geometry type, with a one-click "use this".
 *
 * <p>Both examples are real, parseable boundaries rather than
 * fill-in-the-blank skeletons — a template with the word "easting" in it
 * can't be pasted and tried, so it can't teach anyone whether their input is
 * shaped right. They're kept out of the field's placeholder and behind a
 * disclosure so the common case (paste your own polygon) stays uncluttered.
 *
 * <p>Coordinates are BC Albers (EPSG:3005) metres. Both have been verified
 * through FduGeometryInputParser: the Polygon measures 24 ha (25 ha square
 * less a 1 ha hole) and the MultiPolygon 41 ha (25 + 16).
 */
/** Which worked example was inserted. */
export type BoundaryFormat = 'polygon' | 'multipolygon';

/**
 * What to tell someone after their Boundary field has been filled in for them.
 *
 * <p>Kept beside the examples because it describes them: the Polygon message
 * has to mention the hole, because a reader who sees two rings and is not told
 * otherwise will reasonably conclude they have found the multi-area format.
 * If a sample changes, this changes with it.
 */
export const INSERTED_NOTICE: Record<
  BoundaryFormat,
  { title: string; body: string }
> = {
  polygon: {
    title: 'Polygon example added',
    body:
      'One area, with the second ring cut out as a hole. Replace the '
      + 'coordinates with your own.',
  },
  multipolygon: {
    title: 'MultiPolygon example added',
    body: 'Two separate areas. Replace the coordinates with your own.',
  },
};

interface Props {
  /** Fills the Boundary field with the shown example. */
  onUseExample: (geometry: string, format: BoundaryFormat) => void;
  disabled?: boolean;
}

/** 500 m square with a 100 m hole punched out of the middle. */
const POLYGON_EXAMPLE = `{"type":"Polygon","coordinates":[
  [[1200000,460000],[1200500,460000],[1200500,460500],[1200000,460500],[1200000,460000]],
  [[1200100,460100],[1200200,460100],[1200200,460200],[1200100,460200],[1200100,460100]]]}`;

/** Two detached parts — a 500 m square and a 400 m square. */
const MULTIPOLYGON_EXAMPLE = `{"type":"MultiPolygon","coordinates":[
  [[[1200000,460000],[1200500,460000],[1200500,460500],[1200000,460500],[1200000,460000]]],
  [[[1201000,461000],[1201400,461000],[1201400,461400],[1201000,461400],[1201000,461000]]]]}`;

const BoundaryExamples: FC<Props> = ({ onUseExample, disabled }) => (
  // The gap lives on this wrapper, not on <Accordion>: Carbon's
  // `.cds--accordion { margin: 0 }` is emitted after our component CSS at the
  // same specificity, so a margin set on the accordion itself is reset.
  <div className="add-fdu__examples-wrap">
    <Accordion align="start" className="add-fdu__examples">
      <AccordionItem title="See example formats — Polygon or MultiPolygon">
        <Tabs>
          <TabList aria-label="Boundary example formats">
            <Tab>Polygon</Tab>
            <Tab>MultiPolygon</Tab>
          </TabList>
          <TabPanels>
            <TabPanel>
              <p className="add-fdu__example-desc">
                One continuous area. The first ring is the outer boundary; any
                ring after it is a hole cut out of that area.
              </p>
              <CodeSnippet type="multi" wrapText={false} feedback="Copied">
                {POLYGON_EXAMPLE}
              </CodeSnippet>
              <Button
                kind="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onUseExample(POLYGON_EXAMPLE, 'polygon')}
              >
                Use this example
              </Button>
            </TabPanel>
            <TabPanel>
              <p className="add-fdu__example-desc">
                Two or more separate areas in one unit. Each area gets its own
                set of brackets, and each can have its own holes.
              </p>
              <CodeSnippet type="multi" wrapText={false} feedback="Copied">
                {MULTIPOLYGON_EXAMPLE}
              </CodeSnippet>
              <Button
                kind="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onUseExample(MULTIPOLYGON_EXAMPLE, 'multipolygon')}
              >
                Use this example
              </Button>
            </TabPanel>
          </TabPanels>
        </Tabs>
        <p className="add-fdu__example-note">
          Coordinates are eastings and northings in metres. Every ring closes by
          repeating its first point at the end.
        </p>
      </AccordionItem>
    </Accordion>
  </div>
);

export default BoundaryExamples;
export { BoundaryExamples, POLYGON_EXAMPLE, MULTIPOLYGON_EXAMPLE };
