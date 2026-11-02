import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
export class ReportQueryDto {
  @IsString() from: string;
  @IsString() to: string;
  @IsOptional() @IsString() @MaxLength(128) customerId?: string;
  @IsOptional() @IsString() @MaxLength(128) campaignId?: string;
  @IsOptional() @IsIn(['CHANNEL', 'POST']) scope?: 'CHANNEL' | 'POST';
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value
  )
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  integrationIds?: string[];
}
export class SyncReportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  integrationIds: string[];
  @IsOptional() @IsString() @MaxLength(128) customerId?: string;
}
export class CreateReportCampaignDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;
  @IsOptional() @IsString() @MaxLength(128) customerId?: string;
  @IsString() from: string;
  @IsString() to: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  postIds: string[];
}

export class ReportSelectionDto {
  @IsOptional() @IsString() @MaxLength(128) customerId?: string;
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value
  )
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  integrationIds?: string[];
}
