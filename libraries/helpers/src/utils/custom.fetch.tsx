'use client';

import { createContext, FC, ReactNode, useContext, useMemo } from 'react';
import { customFetch, Params } from './custom.fetch.func';
import { useVariables } from '@gitroom/react/helpers/variable.context';

const FetchProvider = createContext(
  customFetch(
    // @ts-ignore
    {
      baseUrl: '',
      beforeRequest: () => {},
      afterRequest: () => {
        return true;
      },
    } as Params
  )
);

export const FetchWrapperComponent: FC<Params & { children: ReactNode }> = (
  props
) => {
  const { children, baseUrl, beforeRequest, afterRequest } = props;
  const { isSecured } = useVariables();
  const fetchData = useMemo(
    () =>
      customFetch(
        { baseUrl, beforeRequest, afterRequest },
        undefined,
        undefined,
        isSecured
      ),
    [baseUrl, beforeRequest, afterRequest, isSecured]
  );
  return (
    // @ts-ignore
    <FetchProvider.Provider value={fetchData}>
      {children}
    </FetchProvider.Provider>
  );
};

export const useFetch = () => {
  return useContext(FetchProvider);
};
