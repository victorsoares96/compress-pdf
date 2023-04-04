import { sayMyName } from '@/sayMyName';

describe('sayMyName', () => {
  it('should return my name', () => {
    const result = sayMyName({ name: 'Victor' });
    const expectedResult = 'Your name is Victor';
    expect(result).toEqual(expectedResult);
  });
});
